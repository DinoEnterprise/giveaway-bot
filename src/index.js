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
    description: "End and delete a giveaway",
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

/* =========================
   RESPONSE
========================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}

/* =========================
   DISCORD SIGNATURE
========================= */

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

async function verifyDiscordRequest(
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
      "Signature verification error:",
      error
    );

    return false;
  }
}

/* =========================
   DISCORD BOT API
========================= */

async function discordFetch(
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
  const url =
    `/applications/${env.DISCORD_APPLICATION_ID}` +
    `/guilds/${env.DISCORD_GUILD_ID}` +
    `/commands`;

  const result =
    await discordFetch(
      url,
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
   GET ORIGINAL INTERACTION
   MESSAGE
========================= */

async function getOriginalMessage(
  interaction,
  env
) {
  const url =
    `/webhooks/${env.DISCORD_APPLICATION_ID}` +
    `/${interaction.token}/messages/@original`;

  const result =
    await discordFetch(
      url,
      env,
      {
        method: "GET"
      }
    );

  if (!result.ok) {
    const error =
      await result.text();

    throw new Error(
      `Get original message failed: ${error}`
    );
  }

  return result.json();
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
    await discordFetch(
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
    const error =
      await result.text();

    throw new Error(
      `Delete message failed: ${error}`
    );
  }

  return true;
}

/* =========================
   FETCH GIVEAWAY
========================= */

async function getGiveaway(
  id,
  env
) {
  const result =
    await env.DB
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

  return result;
}

/* =========================
   MAIN WORKER
========================= */

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
        await verifyDiscordRequest(
          request,
          env
        );

      if (!valid) {
        return new Response(
          "Invalid request signature",
          {
            status: 401
          }
        );
      }

      const interaction =
        await request.json();

      /* ===================
         DISCORD PING
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

        console.log(
          "Command:",
          command
        );

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

          const guildId =
            interaction.guild_id;

          const channelId =
            interaction.channel_id;

          try {
            /*
             * Save giveaway first.
             */
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
                guildId,
                channelId,
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
              "D1 giveaway error:",
              error
            );

            return json({
              type: 4,
              data: {
                content:
                  "❌ Gagal membuat giveaway di database."
              }
            });
          }

          /*
           * Respond immediately to Discord.
           */
          const discordResponse =
            json({
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
                  `ID: \`${giveawayId}\``
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

          /*
           * Setelah response dikirim,
           * ambil message ID dari Discord
           * dan simpan ke D1.
           */
          ctx.waitUntil(
            (async () => {
              try {
                /*
                 * Tunggu sedikit supaya
                 * original response tersedia.
                 */
                await new Promise(
                  resolve =>
                    setTimeout(
                      resolve,
                      300
                    )
                );

                const message =
                  await getOriginalMessage(
                    interaction,
                    env
                  );

                await env.DB
                  .prepare(
                    `
                    UPDATE giveaways
                    SET message_id = ?
                    WHERE id = ?
                    `
                  )
                  .bind(
                    message.id,
                    giveawayId
                  )
                  .run();

                console.log(
                  "Giveaway message saved:",
                  message.id
                );

              } catch (error) {
                console.error(
                  "Save message ID error:",
                  error
                );
              }
            })()
          );

          return discordResponse;
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

          if (!giveawayId) {
            return json({
              type: 4,
              data: {
                content:
                  "❌ Giveaway ID wajib diisi."
              }
            });
          }

          try {
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
              giveaway.status !==
              "active"
            ) {
              return json({
                type: 4,
                data: {
                  content:
                    "❌ Giveaway sudah tidak aktif."
                }
              });
            }

            /*
             * Hapus pesan giveaway
             * menggunakan akun BOT.
             */
            if (
              giveaway.message_id &&
              giveaway.channel_id
            ) {
              await deleteMessage(
                giveaway.channel_id,
                giveaway.message_id,
                env
              );
            }

            /*
             * Update database.
             */
            await env.DB
              .prepare(
                `
                UPDATE giveaways
                SET status = ?
                WHERE id = ?
                `
              )
              .bind(
                "ended",
                giveawayId
              )
              .run();

            return json({
              type: 4,
              data: {
                content:
                  `✅ Giveaway \`${giveawayId}\` berhasil diakhiri dan pesannya dihapus oleh bot.`
              }
            });

          } catch (error) {
            console.error(
              "Giveaway end error:",
              error
            );

            return json({
              type: 4,
              data: {
                content:
                  "❌ Gagal mengakhiri giveaway. Pastikan bot punya **Manage Messages**."
              }
            });
          }
        }

        /* =================
           TICKET CLOSE
        ================= */

        if (
          command ===
          "ticket-close"
        ) {
          return json({
            type: 4,
            data: {
              content:
                "🔒 Sistem ticket-close akan kita pasang setelah Claim selesai."
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

        /*
         * CLAIM BUTTON
         */
        if (
          customId.startsWith(
            "claim:"
          )
        ) {
          const giveawayId =
            customId.substring(
              6
            );

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

          return json({
            type: 4,
            data: {
              content: [
                "🎁 **CLAIM GIVEAWAY**",
                "",
                `Prize: **${giveaway.prize}**`,
                "",
                "Sistem claim/ticket sedang diproses."
              ].join("\n"),

              flags: 64
            }
          });
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
