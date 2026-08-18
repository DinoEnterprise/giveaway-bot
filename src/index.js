const DISCORD_API = "https://discord.com/api/v10";

/* =========================================================
   COMMANDS
========================================================= */

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
    description: "Close current ticket"
  }
];

/* =========================================================
   BASIC RESPONSE
========================================================= */

function response(data, status = 200) {
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

/* =========================================================
   HEX
========================================================= */

function hexToBytes(hex) {
  const bytes =
    new Uint8Array(
      hex.length / 2
    );

  for (
    let i = 0;
    i < hex.length;
    i += 2
  ) {
    bytes[i / 2] =
      parseInt(
        hex.substring(i, i + 2),
        16
      );
  }

  return bytes;
}

/* =========================================================
   VERIFY DISCORD
========================================================= */

async function verifyDiscord(
  request,
  env
) {
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
    const publicKey =
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
      publicKey,
      hexToBytes(signature),
      new TextEncoder().encode(
        timestamp + body
      )
    );
  } catch (error) {
    console.error(
      "VERIFY ERROR:",
      error
    );

    return false;
  }
}

/* =========================================================
   DISCORD API
========================================================= */

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

/* =========================================================
   REGISTER
========================================================= */

async function registerCommands(
  env
) {
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
          JSON.stringify(
            COMMANDS
          )
      }
    );

  const text =
    await result.text();

  let data;

  try {
    data =
      JSON.parse(text);
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

/* =========================================================
   GET GIVEAWAY
========================================================= */

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

/* =========================================================
   GET CLAIM
========================================================= */

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

/* =========================================================
   CREATE TICKET CHANNEL
========================================================= */

async function createTicketChannel(
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
      "DISCORD_TICKET_CATEGORY_ID kosong"
    );
  }

  if (!staffRoleId) {
    throw new Error(
      "DISCORD_STAFF_ROLE_ID kosong"
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
      .slice(0, 60);

  /*
   * Discord permission bits:
   *
   * VIEW_CHANNEL          = 1024
   * SEND_MESSAGES         = 2048
   * READ_MESSAGE_HISTORY  = 65536
   *
   * Total:
   * 1024 + 2048 + 65536
   * = 68608
   */

  const permissions =
    "68608";

  const overwrites = [
    /*
     * @everyone
     * tidak bisa melihat ticket
     */
    {
      id: guildId,
      type: 0,
      deny: "1024"
    },

    /*
     * Claimer
     */
    {
      id: user.id,
      type: 1,
      allow: permissions
    },

    /*
     * Staff
     */
    {
      id: staffRoleId,
      type: 0,
      allow: permissions
    }
  ];

  const result =
    await discord(
      `/guilds/${guildId}/channels`,
      env,
      {
        method: "POST",

        body:
          JSON.stringify({
            name:
              `claim-${safeName}`,

            type: 0,

            parent_id:
              categoryId,

            permission_overwrites:
              overwrites,

            topic:
              `Giveaway ${giveaway.id} | User ${user.id}`
          })
      }
    );

  const text =
    await result.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = {
      message: text
    };
  }

  if (!result.ok) {
    throw new Error(
      `Discord ${result.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/* =========================================================
   SEND TICKET MESSAGE
========================================================= */

async function sendTicketMessage(
  channelId,
  giveaway,
  user,
  env
) {
  const result =
    await discord(
      `/channels/${channelId}/messages`,
      env,
      {
        method: "POST",

        body:
          JSON.stringify({
            content: [
              "🎟️ **ROBUX GIVEAWAY CLAIM**",
              "",
              `👤 <@${user.id}>`,
              `🎁 **Prize:** ${giveaway.prize}`,
              `🏆 **Winners:** ${giveaway.winners}`,
              `🆔 **Giveaway:** \`${giveaway.id}\``,
              "",
              "Claim kamu sudah masuk.",
              "Silakan tunggu staff memproses hadiah.",
              "",
              "Staff dapat menggunakan `/ticket-close` untuk menutup ticket."
            ].join("\n")
          })
      }
    );

  if (!result.ok) {
    throw new Error(
      `Send ticket message failed: ${await result.text()}`
    );
  }
}

/* =========================================================
   EDIT ORIGINAL INTERACTION RESPONSE
========================================================= */

async function editInteraction(
  interaction,
  env,
  data
) {
  const path =
    `/webhooks/${env.DISCORD_APPLICATION_ID}` +
    `/${interaction.token}` +
    `/messages/@original`;

  const result =
    await discord(
      path,
      env,
      {
        method: "PATCH",

        body:
          JSON.stringify(data)
      }
    );

  if (!result.ok) {
    console.error(
      "EDIT INTERACTION:",
      await result.text()
    );
  }

  return result;
}

/* =========================================================
   DELETE GIVEAWAY MESSAGE
========================================================= */

async function deleteGiveawayMessage(
  giveaway,
  env
) {
  if (
    !giveaway.channel_id ||
    !giveaway.message_id
  ) {
    throw new Error(
      "message_id giveaway belum tersimpan"
    );
  }

  const result =
    await discord(
      `/channels/${giveaway.channel_id}/messages/${giveaway.message_id}`,
      env,
      {
        method: "DELETE"
      }
    );

  if (
    !result.ok &&
    result.status !== 404
  ) {
    throw new Error(
      `Delete failed: ${await result.text()}`
    );
  }
}

/* =========================================================
   WORKER
========================================================= */

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(
        request.url
      );

    /* =====================================================
       HOME
    ===================================================== */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return response({
        status: "online",
        database:
          Boolean(env.DB),
        bot:
          Boolean(
            env.DISCORD_TOKEN
          )
      });
    }

    /* =====================================================
       DEBUG
    ===================================================== */

    if (
      request.method === "GET" &&
      url.pathname === "/debug"
    ) {
      return response({
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

    /* =====================================================
       REGISTER
    ===================================================== */

    if (
      request.method === "GET" &&
      url.pathname === "/register"
    ) {
      try {
        const commands =
          await registerCommands(
            env
          );

        return response({
          success: true,
          commands
        });

      } catch (error) {
        return response({
          success: false,
          error:
            error.message
        });
      }
    }

    /* =====================================================
       DISCORD INTERACTION
    ===================================================== */

    if (
      request.method === "POST" &&
      url.pathname === "/interactions"
    ) {
      const valid =
        await verifyDiscord(
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

      /* ===================================================
         PING
      =================================================== */

      if (
        interaction.type === 1
      ) {
        return response({
          type: 1
        });
      }

      /* ===================================================
         SLASH COMMAND
      =================================================== */

      if (
        interaction.type === 2
      ) {
        const command =
          interaction.data?.name;

        /* ===============================================
           /giveaway
        =============================================== */

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
                x.name ===
                "prize"
            )?.value;

          const winners =
            options.find(
              x =>
                x.name ===
                "winners"
            )?.value;

          const giveawayId =
            `GW-${crypto.randomUUID()}`;

          const creator =
            interaction.member
              ?.user?.id ||
            interaction.user?.id ||
            "unknown";

          /*
           * Simpan giveaway
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
                creator,
                new Date().toISOString()
              )
              .run();

          } catch (error) {
            console.error(
              "GIVEAWAY D1 ERROR:",
              error
            );

            return response({
              type: 4,
              data: {
                content:
                  "❌ Gagal menyimpan giveaway."
              }
            });
          }

          /*
           * Response langsung.
           */
          return response({
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

        /* ===============================================
           /giveaway-end
        =============================================== */

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
           * Ambil data.
           */
          const giveaway =
            await getGiveaway(
              giveawayId,
              env
            );

          if (!giveaway) {
            return response({
              type: 4,
              data: {
                content:
                  "❌ Giveaway tidak ditemukan."
              }
            });
          }

          /*
           * DEFER
           *
           * Discord langsung tahu
           * kita sedang memproses.
           */
          const deferred =
            response({
              type: 5
            });

          /*
           * Setelah response dikirim,
           * proses penghapusan.
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

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `✅ Giveaway \`${giveawayId}\` berhasil diakhiri dan pesan giveaway dihapus.`
                  }
                );

              } catch (error) {
                console.error(
                  "GIVEAWAY END ERROR:",
                  error
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `❌ Gagal menghapus giveaway.\n\n\`${error.message}\``
                  }
                );
              }
            })()
          );

          return deferred;
        }

        /* ===============================================
           /ticket-close
        =============================================== */

        if (
          command ===
          "ticket-close"
        ) {
          const channelId =
            interaction.channel_id;

          const deferred =
            response({
              type: 5,
              data: {
                flags: 64
              }
            });

          ctx.waitUntil(
            (async () => {
              try {
                const ticket =
                  await env.DB
                    .prepare(
                      `
                      SELECT *
                      FROM tickets
                      WHERE channel_id = ?
                      AND status = 'open'
                      LIMIT 1
                      `
                    )
                    .bind(
                      channelId
                    )
                    .first();

                if (!ticket) {
                  await editInteraction(
                    interaction,
                    env,
                    {
                      content:
                        "❌ Channel ini bukan ticket aktif."
                    }
                  );

                  return;
                }

                await env.DB
                  .prepare(
                    `
                    UPDATE tickets
                    SET status = 'closed'
                    WHERE id = ?
                    `
                  )
                  .bind(
                    ticket.id
                  )
                  .run();

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      "🔒 Ticket berhasil ditutup."
                  }
                );

              } catch (error) {
                console.error(
                  "TICKET CLOSE ERROR:",
                  error
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `❌ ${error.message}`
                  }
                );
              }
            })()
          );

          return deferred;
        }
      }

      /* ===================================================
         BUTTON
      =================================================== */

      if (
        interaction.type === 3
      ) {
        const customId =
          interaction.data
            ?.custom_id || "";

        /* ===============================================
           CLAIM
        =============================================== */

        if (
          customId.startsWith(
            "claim:"
          )
        ) {
          const giveawayId =
            customId.substring(
              6
            );

          const user =
            interaction.member
              ?.user ||
            interaction.user;

          const userId =
            user?.id;

          /*
           * Cari giveaway.
           */
          const giveaway =
            await getGiveaway(
              giveawayId,
              env
            );

          if (!giveaway) {
            return response({
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
            return response({
              type: 4,
              data: {
                content:
                  "❌ Giveaway sudah berakhir.",
                flags: 64
              }
            });
          }

          /*
           * Cek claim lama.
           */
          const existing =
            await getClaim(
              giveawayId,
              userId,
              env
            );

          if (existing) {
            return response({
              type: 4,
              data: {
                content:
                  "❌ Kamu sudah claim giveaway ini.",
                flags: 64
              }
            });
          }

          /*
           * =============================================
           * DEFERRED RESPONSE
           * =============================================
           *
           * Discord langsung menerima ACK.
           */
          const deferred =
            response({
              type: 5,
              data: {
                flags: 64
              }
            });

          /*
           * Semua proses ticket
           * setelah ACK.
           */
          ctx.waitUntil(
            (async () => {
              const claimId =
                crypto.randomUUID();

              try {
                console.log(
                  "CLAIM START:",
                  giveawayId,
                  userId
                );

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

                console.log(
                  "CLAIM SAVED"
                );

                /*
                 * CREATE CHANNEL
                 */
                const channel =
                  await createTicketChannel(
                    interaction,
                    giveaway,
                    user,
                    env
                  );

                console.log(
                  "CHANNEL CREATED:",
                  channel.id
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
                 * MESSAGE
                 */
                await sendTicketMessage(
                  channel.id,
                  giveaway,
                  user,
                  env
                );

                /*
                 * UPDATE CLAIM
                 */
                await env.DB
                  .prepare(
                    `
                    UPDATE claims
                    SET status = 'completed'
                    WHERE id = ?
                    `
                  )
                  .bind(
                    claimId
                  )
                  .run();

                /*
                 * EDIT DISCORD RESPONSE
                 */
                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `🎟️ **Ticket berhasil dibuat!**\n\nSilakan masuk ke <#${channel.id}>.`
                  }
                );

                console.log(
                  "CLAIM COMPLETE"
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

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `❌ **Gagal membuat ticket.**\n\n\`${error.message}\``
                  }
                );
              }
            })()
          );

          return deferred;
        }
      }

      return response({
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
