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

/* =========================
   HEX → BYTES
========================= */

function hexToBytes(hex) {
  const bytes = new Uint8Array(
    hex.length / 2
  );

  for (
    let i = 0;
    i < hex.length;
    i += 2
  ) {
    bytes[i / 2] =
      parseInt(
        hex.slice(i, i + 2),
        16
      );
  }

  return bytes;
}

/* =========================
   DISCORD SIGNATURE
========================= */

async function verifyRequest(
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

    return crypto.subtle.verify(
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

/* =========================
   DISCORD API
========================= */

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

/* =========================
   REGISTER COMMANDS
========================= */

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
          JSON.stringify(
            COMMANDS
          )
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

/* =========================
   GET GIVEAWAY
========================= */

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

/* =========================
   GET CLAIM
========================= */

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
   GET TICKET
========================= */

async function getTicket(
  giveawayId,
  userId,
  env
) {
  return env.DB
    .prepare(
      `
      SELECT *
      FROM tickets
      WHERE giveaway_id = ?
      AND user_id = ?
      AND status = 'open'
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
   CREATE DISCORD TICKET
========================= */

async function createTicketChannel(
  interaction,
  giveaway,
  userId,
  username,
  env
) {
  const categoryId =
    env.DISCORD_TICKET_CATEGORY_ID;

  const staffRoleId =
    env.DISCORD_STAFF_ROLE_ID;

  if (!categoryId) {
    throw new Error(
      "DISCORD_TICKET_CATEGORY_ID belum diatur."
    );
  }

  if (!staffRoleId) {
    throw new Error(
      "DISCORD_STAFF_ROLE_ID belum diatur."
    );
  }

  const guildId =
    interaction.guild_id;

  const channelName =
    `claim-${username}`
      .toLowerCase()
      .replace(
        /[^a-z0-9-]/g,
        "-"
      )
      .slice(0, 80);

  const overwrites = [
    {
      id: guildId,
      type: 0,
      deny: "1024"
    },
    {
      id: userId,
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

  const result =
    await discord(
      `/guilds/${guildId}/channels`,
      env,
      {
        method: "POST",
        body: JSON.stringify({
          name:
            channelName,
          type: 0,
          parent_id:
            categoryId,
          permission_overwrites:
            overwrites,
          topic:
            `Giveaway claim ${giveaway.id} - User ${userId}`
        })
      }
    );

  const text =
    await result.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      message: text
    };
  }

  if (!result.ok) {
    throw new Error(
      `Discord create channel error: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/* =========================
   SEND TICKET MESSAGE
========================= */

async function sendTicketMessage(
  channelId,
  giveaway,
  userId,
  env
) {
  const result =
    await discord(
      `/channels/${channelId}/messages`,
      env,
      {
        method: "POST",
        body: JSON.stringify({
          content: [
            "🎟️ **GIVEAWAY CLAIM TICKET**",
            "",
            `👤 <@${userId}>`,
            `🎁 **Prize:** ${giveaway.prize}`,
            `🏆 **Winners:** ${giveaway.winners}`,
            `🆔 **Giveaway:** \`${giveaway.id}\``,
            "",
            "Staff akan memproses claim kamu.",
            "",
            "Gunakan `/ticket-close` jika ticket sudah selesai."
          ].join("\n")
        })
      }
    );

  if (!result.ok) {
    console.error(
      "Ticket message error:",
      await result.text()
    );
  }
}

/* =========================
   DELETE MESSAGE
========================= */

async function deleteMessage(
  channelId,
  messageId,
  env
) {
  const result =
    await discord(
      `/channels/${channelId}/messages/${messageId}`,
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
      await result.text()
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
          Boolean(
            env.DISCORD_TOKEN
          )
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
       DISCORD
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

          const userId =
            interaction.member
              ?.user?.id ||
            interaction.user?.id ||
            "unknown";

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
              "Giveaway D1 error:",
              error
            );

            return json({
              type: 4,
              data: {
                content:
                  "❌ Gagal menyimpan giveaway."
              }
            });
          }

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

          if (
            giveaway.message_id
          ) {
            try {
              await deleteMessage(
                giveaway.channel_id,
                giveaway.message_id,
                env
              );
            } catch (error) {
              console.error(
                "Delete giveaway error:",
                error
              );
            }
          }

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

          return json({
            type: 4,
            data: {
              content:
                `✅ Giveaway \`${giveawayId}\` diakhiri.`
            }
          });
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
            return json({
              type: 4,
              data: {
                content:
                  "❌ Channel ini bukan ticket aktif.",
                flags: 64
              }
            });
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

          return json({
            type: 4,
            data: {
              content:
                "🔒 Ticket ditutup."
            }
          });
        }

        return json({
          type: 4,
          data: {
            content:
              "❌ Command tidak dikenal."
          }
        });
      }

      /* ===================
         BUTTON
      =================== */

      if (
        interaction.type === 3
      ) {
        const customId =
          interaction.data
            ?.custom_id || "";

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

          const username =
            user?.username ||
            `user-${userId}`;

          /* =================
             GET GIVEAWAY
          ================= */

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

          /* =================
             CEK CLAIM
          ================= */

          const existingClaim =
            await getClaim(
              giveawayId,
              userId,
              env
            );

          if (existingClaim) {
            const existingTicket =
              await getTicket(
                giveawayId,
                userId,
                env
              );

            if (
              existingTicket
            ) {
              return json({
                type: 4,
                data: {
                  content:
                    `🎟️ Kamu sudah memiliki ticket: <#${existingTicket.channel_id}>`,
                  flags: 64
                }
              });
            }

            return json({
              type: 4,
              data: {
                content:
                  "❌ Kamu sudah pernah claim giveaway ini.",
                flags: 64
              }
            });
          }

          /* =================
             BUAT CLAIM
          ================= */

          const claimId =
            crypto.randomUUID();

          try {
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
                username,
                user?.global_name ||
                  username,
                "processing",
                new Date().toISOString()
              )
              .run();

          } catch (error) {
            console.error(
              "Claim insert error:",
              error
            );

            return json({
              type: 4,
              data: {
                content:
                  "❌ Claim gagal dibuat. Coba lagi.",
                flags: 64
              }
            });
          }

          /* =================
             BUAT TICKET
          ================= */

          try {
            const ticketChannel =
              await createTicketChannel(
                interaction,
                giveaway,
                userId,
                username,
                env
              );

            const ticketId =
              crypto.randomUUID();

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
                ticketId,
                giveawayId,
                claimId,
                userId,
                ticketChannel.id,
                "open",
                new Date().toISOString()
              )
              .run();

            await sendTicketMessage(
              ticketChannel.id,
              giveaway,
              userId,
              env
            );

            return json({
              type: 4,
              data: {
                content:
                  `🎟️ **Ticket berhasil dibuat!**\n\nSilakan masuk ke <#${ticketChannel.id}>.`,
                flags: 64
              }
            });

          } catch (error) {
            console.error(
              "Ticket creation error:",
              error
            );

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

            return json({
              type: 4,
              data: {
                content: [
                  "❌ **Gagal membuat ticket.**",
                  "",
                  "Pastikan bot mempunyai:",
                  "• Manage Channels",
                  "• View Channels",
                  "• Send Messages",
                  "",
                  `Error: \`${error.message}\``
                ].join("\n"),
                flags: 64
              }
            });
          }
        }

        return json({
          type: 4,
          data: {
            content:
              "❌ Tombol tidak dikenal.",
            flags: 64
          }
        });
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
