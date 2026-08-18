const DISCORD_API = "https://discord.com/api/v10";

const COMMANDS = [
  {
    name: "giveaway",
    description: "Create a Robux giveaway",
    options: [
      {
        name: "prize",
        description: "Giveaway prize",
        type: 3,
        required: true
      },
      {
        name: "winners",
        description: "Number of winners",
        type: 4,
        required: true,
        min_value: 1,
        max_value: 100
      }
    ]
  },
  {
    name: "giveaway-end",
    description: "End a giveaway",
    options: [
      {
        name: "id",
        description: "Giveaway ID",
        type: 3,
        required: true
      }
    ]
  },
  {
    name: "ticket-close",
    description: "Close the current ticket"
  }
];

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(
      hex.slice(i, i + 2),
      16
    );
  }

  return bytes;
}

async function verifyRequest(request, env) {
  const signature =
    request.headers.get(
      "X-Signature-Ed25519"
    );

  const timestamp =
    request.headers.get(
      "X-Signature-Timestamp"
    );

  if (
    !signature ||
    !timestamp ||
    !env.DISCORD_PUBLIC_KEY
  ) {
    return false;
  }

  const body =
    await request.clone().text();

  try {
    const key =
      await crypto.subtle.importKey(
        "raw",
        hexToBytes(
          env.DISCORD_PUBLIC_KEY
        ),
        {
          name: "Ed25519"
        },
        false,
        ["verify"]
      );

    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(
        timestamp + body
      )
    );
  } catch (error) {
    console.error(
      "Signature error:",
      error
    );

    return false;
  }
}

async function discord(
  path,
  env,
  options = {}
) {
  return fetch(
    `${DISCORD_API}${path}`,
    {
      ...options,
      headers: {
        Authorization:
          `Bot ${env.DISCORD_TOKEN}`,
        "Content-Type":
          "application/json",
        ...(options.headers || {})
      }
    }
  );
}

async function registerCommands(env) {
  const path =
    `/applications/${env.DISCORD_APPLICATION_ID}` +
    `/guilds/${env.DISCORD_GUILD_ID}` +
    `/commands`;

  const result =
    await discord(
      path,
      env,
      {
        method: "PUT",
        body:
          JSON.stringify(COMMANDS)
      }
    );

  const text =
    await result.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!result.ok) {
    throw new Error(
      JSON.stringify(data)
    );
  }

  return data;
}

async function getGiveaway(
  id,
  env
) {
  return env.DB
    .prepare(
      `
      SELECT *
      FROM giveaways
      WHERE id = ?
      LIMIT 1
      `
    )
    .bind(id)
    .first();
}

async function getClaim(
  giveawayId,
  userId,
  env
) {
  return env.DB
    .prepare(
      `
      SELECT *
      FROM claims
      WHERE giveaway_id = ?
      AND user_id = ?
      LIMIT 1
      `
    )
    .bind(
      giveawayId,
      userId
    )
    .first();
}

/* =========================
   CREATE TICKET
========================= */

async function createTicket(
  interaction,
  giveaway,
  user,
  env
) {
  const guildId =
    interaction.guild_id;

  const categoryId =
    env.DISCORD_TICKET_CATEGORY_ID;

  const staffRoleId =
    env.DISCORD_STAFF_ROLE_ID;

  if (!categoryId) {
    throw new Error(
      "DISCORD_TICKET_CATEGORY_ID tidak ditemukan"
    );
  }

  if (!staffRoleId) {
    throw new Error(
      "DISCORD_STAFF_ROLE_ID tidak ditemukan"
    );
  }

  const username =
    user.username ||
    `user-${user.id}`;

  const safeName =
    username
      .toLowerCase()
      .replace(
        /[^a-z0-9-]/g,
        "-"
      )
      .slice(0, 70);

  /*
   * Permission:
   *
   * @everyone
   * DENY View Channel
   *
   * User
   * ALLOW View Channel,
   * Send Messages,
   * Read Message History
   *
   * Staff
   * ALLOW View Channel,
   * Send Messages,
   * Read Message History
   */

  const permissionOverwrites = [
    {
      id: guildId,
      type: 0,
      deny: "1024"
    },
    {
      id: user.id,
      type: 1,
      allow:
        "68608"
    },
    {
      id: staffRoleId,
      type: 0,
      allow:
        "68608"
    }
  ];

  const response =
    await discord(
      `/guilds/${guildId}/channels`,
      env,
      {
        method: "POST",
        body: JSON.stringify({
          name:
            `claim-${safeName}`,
          type: 0,
          parent_id:
            categoryId,
          permission_overwrites:
            permissionOverwrites,
          topic:
            `Giveaway ${giveaway.id} | User ${user.id}`
        })
      }
    );

  const text =
    await response.text();

  let channel;

  try {
    channel =
      JSON.parse(text);
  } catch {
    throw new Error(text);
  }

  if (!response.ok) {
    throw new Error(
      JSON.stringify(channel)
    );
  }

  return channel;
}

/* =========================
   SEND TICKET MESSAGE
========================= */

async function sendTicketMessage(
  channelId,
  giveaway,
  user,
  env
) {
  const response =
    await discord(
      `/channels/${channelId}/messages`,
      env,
      {
        method: "POST",
        body: JSON.stringify({
          content: [
            "🎟️ **ROBUX GIVEAWAY CLAIM**",
            "",
            `👤 <@${user.id}>`,
            `🎁 **Prize:** ${giveaway.prize}`,
            `🏆 **Winners:** ${giveaway.winners}`,
            `🆔 **Giveaway:** \`${giveaway.id}\``,
            "",
            "Halo! Claim kamu sudah masuk.",
            "Silakan tunggu staff memproses hadiah.",
            "",
            "🔒 Staff dapat menggunakan `/ticket-close` untuk menutup ticket."
          ].join("\n")
        })
      }
    );

  if (!response.ok) {
    console.error(
      "Ticket message error:",
      await response.text()
    );
  }
}

/* =========================
   DELETE GIVEAWAY MESSAGE
========================= */

async function deleteGiveawayMessage(
  giveaway,
  env
) {
  if (
    !giveaway.message_id ||
    !giveaway.channel_id
  ) {
    return;
  }

  const response =
    await discord(
      `/channels/${giveaway.channel_id}/messages/${giveaway.message_id}`,
      env,
      {
        method: "DELETE"
      }
    );

  if (
    !response.ok &&
    response.status !== 404
  ) {
    throw new Error(
      await response.text()
    );
  }
}

/* =========================
   WORKER
========================= */

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(request.url);

    /* =====================
       HOME
    ===================== */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        status: "online",
        database:
          Boolean(env.DB),
        bot:
          Boolean(env.DISCORD_TOKEN)
      });
    }

    /* =====================
       DEBUG
    ===================== */

    if (
      request.method === "GET" &&
      url.pathname === "/debug"
    ) {
      return json({
        application_id_exists:
          Boolean(
            env.DISCORD_APPLICATION_ID
          ),
        guild_id_exists:
          Boolean(
            env.DISCORD_GUILD_ID
          ),
        token_exists:
          Boolean(
            env.DISCORD_TOKEN
          ),
        public_key_exists:
          Boolean(
            env.DISCORD_PUBLIC_KEY
          ),
        staff_role_exists:
          Boolean(
            env.DISCORD_STAFF_ROLE_ID
          ),
        ticket_category_exists:
          Boolean(
            env.DISCORD_TICKET_CATEGORY_ID
          ),
        database_exists:
          Boolean(env.DB)
      });
    }

    /* =====================
       REGISTER
    ===================== */

    if (
      request.method === "GET" &&
      url.pathname === "/register"
    ) {
      try {
        const commands =
          await registerCommands(
            env
          );

        return json({
          success: true,
          commands
        });
      } catch (error) {
        return json({
          success: false,
          error:
            error.message
        });
      }
    }

    /* =====================
       DISCORD INTERACTIONS
    ===================== */

    if (
      request.method === "POST" &&
      url.pathname === "/interactions"
    ) {
      const valid =
        await verifyRequest(
          request,
          env
        );

      if (!valid) {
        return new Response(
          "Invalid signature",
          {
            status: 401
          }
        );
      }

      const interaction =
        await request.json();

      /* ===================
         PING
      =================== */

      if (
        interaction.type === 1
      ) {
        return json({
          type: 1
        });
      }

      /* ===================
         SLASH COMMAND
      =================== */

      if (
        interaction.type === 2
      ) {
        const command =
          interaction.data?.name;

        /* =================
           GIVEAWAY
        ================= */

        if (
          command ===
          "giveaway"
        ) {
          const options =
            interaction.data
              ?.options || [];

          const prize =
            options.find(
              x =>
                x.name === "prize"
            )?.value;

          const winners =
            options.find(
              x =>
                x.name === "winners"
            )?.value;

          const giveawayId =
            `GW-${crypto.randomUUID()}`;

          const userId =
            interaction.member
              ?.user?.id ||
            interaction.user?.id ||
            "unknown";

          /*
           * Simpan ke D1.
           */
          try {
            await env.DB
              .prepare(
                `
                INSERT INTO giveaways (
                  id,
                  guild_id,
                  channel_id,
                  message_id,
                  prize,
                  winners,
                  status,
                  created_by,
                  created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
              )
              .bind(
                giveawayId,
                interaction.guild_id,
                interaction.channel_id,
                null,
                String(prize),
                Number(winners),
                "active",
                userId,
                new Date().toISOString()
              )
              .run();
          } catch (error) {
            console.error(
              "D1 error:",
              error
            );

            return json({
              type: 4,
              data: {
                content:
                  "❌ Database error."
              }
            });
          }

          /*
           * ACK LANGSUNG.
           */
          return json({
            type: 4,
            data: {
              content: [
                "🎁 **ROBUX GIVEAWAY**",
                "",
                `**Prize:** ${prize}`,
                `**Winners:** ${winners}`,
                "",
                "Klik tombol di bawah untuk claim.",
                "",
                `🆔 \`${giveawayId}\``
              ].join("\n"),

              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 2,
                      style: 1,
                      label:
                        "🎁 Claim",
                      custom_id:
                        `claim:${giveawayId}`
                    }
                  ]
                }
              ]
            }
          });
        }

        /* =================
           GIVEAWAY END
        ================= */

        if (
          command ===
          "giveaway-end"
        ) {
          const options =
            interaction.data
              ?.options || [];

          const giveawayId =
            options.find(
              x =>
                x.name === "id"
            )?.value;

          /*
           * CEK DULU.
           * Jangan melakukan API
           * sebelum Discord menerima ACK.
           */
          const giveaway =
            await getGiveaway(
              giveawayId,
              env
            );

          if (!giveaway) {
            return json({
              type: 4,
              data: {
                content:
                  "❌ Giveaway tidak ditemukan."
              }
            });
          }

          /*
           * ACK LANGSUNG.
           */
          const response =
            json({
              type: 4,
              data: {
                content:
                  `✅ Giveaway \`${giveawayId}\` sedang diakhiri...`
              }
            });

          /*
           * Semua pekerjaan berat
           * dilakukan setelah ACK.
           */
          ctx.waitUntil(
            (async () => {
              try {
                await deleteGiveawayMessage(
                  giveaway,
                  env
                );

                await env.DB
                  .prepare(
                    `
                    UPDATE giveaways
                    SET status = 'ended'
                    WHERE id = ?
                    `
                  )
                  .bind(
                    giveawayId
                  )
                  .run();

              } catch (error) {
                console.error(
                  "Giveaway end error:",
                  error
                );

                await env.DB
                  .prepare(
                    `
                    UPDATE giveaways
                    SET status = 'ended'
                    WHERE id = ?
                    `
                  )
                  .bind(
                    giveawayId
                  )
                  .run();
              }
            })()
          );

          return response;
        }

        /* =================
           TICKET CLOSE
        ================= */

        if (
          command ===
          "ticket-close"
        ) {
          const channelId =
            interaction.channel_id;

          /*
           * ACK DULU.
           */
          const response =
            json({
              type: 4,
              data: {
                content:
                  "🔒 Ticket sedang ditutup..."
              }
            });

          ctx.waitUntil(
            (async () => {
              try {
                await env.DB
                  .prepare(
                    `
                    UPDATE tickets
                    SET status = 'closed'
                    WHERE channel_id = ?
                    AND status = 'open'
                    `
                  )
                  .bind(
                    channelId
                  )
                  .run();

              } catch (error) {
                console.error(
                  "Ticket close error:",
                  error
                );
              }
            })()
          );

          return response;
        }
      }

      /* =====================
         BUTTON INTERACTION
      ===================== */

      if (
        interaction.type === 3
      ) {
        const customId =
          interaction.data
            ?.custom_id || "";

        /* ===================
           CLAIM
        =================== */

        if (
          customId.startsWith(
            "claim:"
          )
        ) {
          const giveawayId =
            customId.slice(6);

          const user =
            interaction.member
              ?.user ||
            interaction.user;

          const userId =
            user?.id;

          /*
           * CEK GIVEAWAY.
           */
          const giveaway =
            await getGiveaway(
              giveawayId,
              env
            );

          if (!giveaway) {
            return json({
              type: 4,
              data: {
                content:
                  "❌ Giveaway tidak ditemukan.",
                flags: 64
              }
            });
          }

          if (
            giveaway.status !==
            "active"
          ) {
            return json({
              type: 4,
              data: {
                content:
                  "❌ Giveaway sudah berakhir.",
                flags: 64
              }
            });
          }

          /*
           * CEK CLAIM.
           */
          const existing =
            await getClaim(
              giveawayId,
              userId,
              env
            );

          if (existing) {
            return json({
              type: 4,
              data: {
                content:
                  "❌ Kamu sudah claim giveaway ini.",
                flags: 64
              }
            });
          }

          /*
           * ==================
           * ACK SECEPATNYA
           * ==================
           */

          const response =
            json({
              type: 4,
              data: {
                content:
                  "⏳ **Claim diterima!**\n\n🎟️ Ticket sedang dibuat...",
                flags: 64
              }
            });

          /*
           * SEMUA PROSES BERAT
           * SETELAH ACK.
           */

          ctx.waitUntil(
            (async () => {
              const claimId =
                crypto.randomUUID();

              try {
                /*
                 * INSERT CLAIM
                 */
                await env.DB
                  .prepare(
                    `
                    INSERT INTO claims (
                      id,
                      giveaway_id,
                      user_id,
                      username,
                      display_name,
                      status,
                      created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    `
                  )
                  .bind(
                    claimId,
                    giveawayId,
                    userId,
                    user?.username ||
                      "unknown",
                    user?.global_name ||
                      user?.username ||
                      "unknown",
                    "processing",
                    new Date().toISOString()
                  )
                  .run();

                /*
                 * CREATE TICKET
                 */
                const channel =
                  await createTicket(
                    interaction,
                    giveaway,
                    user,
                    env
                  );

                /*
                 * SAVE TICKET
                 */
                await env.DB
                  .prepare(
                    `
                    INSERT INTO tickets (
                      id,
                      giveaway_id,
                      claim_id,
                      user_id,
                      channel_id,
                      status,
                      created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    `
                  )
                  .bind(
                    crypto.randomUUID(),
                    giveawayId,
                    claimId,
                    userId,
                    channel.id,
                    "open",
                    new Date().toISOString()
                  )
                  .run();

                /*
                 * SEND MESSAGE
                 */
                await sendTicketMessage(
                  channel.id,
                  giveaway,
                  user,
                  env
                );

                console.log(
                  "Ticket created:",
                  channel.id
                );

              } catch (error) {
                console.error(
                  "CLAIM ERROR:",
                  error
                );

                try {
                  await env.DB
                    .prepare(
                      `
                      UPDATE claims
                      SET status = 'failed'
                      WHERE id = ?
                      `
                    )
                    .bind(
                      claimId
                    )
                    .run();
                } catch {}
              }
            })()
          );

          return response;
        }
      }

      return json({
        type: 4,
        data: {
          content:
            "❌ Interaction tidak didukung."
        }
      });
    }

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};
