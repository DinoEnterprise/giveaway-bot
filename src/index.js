const DISCORD_API = "https://discord.com/api/v10";
const ROBLOX_API = "https://users.roblox.com";
const ROBLOX_THUMBNAILS = "https://thumbnails.roblox.com";

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
   RESPONSE
========================================================= */

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

/* =========================================================
   HEX
========================================================= */

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(
      hex.substring(i, i + 2),
      16
    );
  }

  return bytes;
}

/* =========================================================
   VERIFY DISCORD
========================================================= */

async function verifyDiscord(request, env) {
  const signature =
    request.headers.get("X-Signature-Ed25519");

  const timestamp =
    request.headers.get("X-Signature-Timestamp");

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
        hexToBytes(env.DISCORD_PUBLIC_KEY),
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
    console.error("VERIFY ERROR:", error);
    return false;
  }
}

/* =========================================================
   DISCORD API
========================================================= */

async function discord(path, env, options = {}) {
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
        body: JSON.stringify(COMMANDS)
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

/* =========================================================
   DATABASE
========================================================= */

async function getGiveaway(id, env) {
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

/* =========================================================
   CREATE TICKET
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

  const discordName =
    user.username ||
    `user-${user.id}`;

  const safeName =
    discordName
      .toLowerCase()
      .replace(
        /[^a-z0-9-]/g,
        "-"
      )
      .slice(0, 35);

  const permissions =
    "68608";

  const overwrites = [
    {
      id: guildId,
      type: 0,
      deny: "1024"
    },

    {
      id: user.id,
      type: 1,
      allow: permissions
    },

    {
      id: staffRoleId,
      type: 0,
      allow: permissions
    },

    {
      id: env.DISCORD_APPLICATION_ID,
      type: 1,
      allow: permissions
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
    data = JSON.parse(text);
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

        body: JSON.stringify({
          content: [
            "🎟️ **ROBUX GIVEAWAY CLAIM**",
            "",
            `👤 Discord: <@${user.id}>`,
            `🎁 Prize: **${giveaway.prize}**`,
            `🏆 Winners: **${giveaway.winners}**`,
            "",
            "Masukkan username Roblox kamu untuk melanjutkan claim.",
            "",
            "Klik tombol di bawah."
          ].join("\n"),

          components: [
            {
              type: 1,

              components: [
                {
                  type: 2,
                  style: 1,
                  label:
                    "🎮 Masukkan Roblox Username",
                  custom_id:
                    `roblox-input:${giveaway.id}`
                }
              ]
            }
          ]
        })
      }
    );

  if (!result.ok) {
    throw new Error(
      `Send ticket message failed: ${await result.text()}`
    );
  }

  return result.json();
}

/* =========================================================
   EDIT INTERACTION
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
        body: JSON.stringify(data)
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
   ROBLOX PROFILE
========================================================= */

async function getRobloxProfile(
  username
) {
  const cleanUsername =
    String(username || "")
      .trim()
      .replace(/^@/, "");

  if (!cleanUsername) {
    return null;
  }

  const lookup =
    await fetch(
      `${ROBLOX_API}/v1/usernames/users`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            usernames: [
              cleanUsername
            ],

            excludeBannedUsers:
              false
          })
      }
    );

  if (!lookup.ok) {
    throw new Error(
      "Roblox API gagal diakses."
    );
  }

  const lookupData =
    await lookup.json();

  if (
    !lookupData.data ||
    lookupData.data.length === 0
  ) {
    return null;
  }

  const user =
    lookupData.data[0];

  let avatarUrl = null;

  try {
    const thumbnail =
      await fetch(
        `${ROBLOX_THUMBNAILS}/v1/users/avatar-headshot` +
        `?userIds=${user.id}` +
        `&size=150x150` +
        `&format=Png` +
        `&isCircular=false`
      );

    if (thumbnail.ok) {
      const thumbnailData =
        await thumbnail.json();

      avatarUrl =
        thumbnailData.data?.[0]?.imageUrl ||
        null;
    }
  } catch (error) {
    console.error(
      "ROBLOX AVATAR ERROR:",
      error
    );
  }

  return {
    id:
      String(user.id),

    username:
      user.name,

    displayName:
      user.displayName,

    avatarUrl
  };
}

/* =========================================================
   ROBLOX MODAL
========================================================= */

function showRobloxModal(
  giveawayId
) {
  return response({
    type: 9,

    data: {
      custom_id:
        `roblox-modal:${giveawayId}`,

      title:
        "Roblox Account",

      components: [
        {
          type: 1,

          components: [
            {
              type: 4,

              custom_id:
                "roblox_username",

              label:
                "Roblox Username",

              style: 1,

              min_length: 3,

              max_length: 20,

              required: true,

              placeholder:
                "Contoh: Builderman"
            }
          ]
        }
      ]
    }
  });
}

/* =========================================================
   ROBLOX PREVIEW
========================================================= */

function robloxPreview(
  profile,
  giveawayId
) {
  const embed = {
    title:
      "🎮 Apakah ini akun Roblox Anda?",

    description:
      "Periksa profil Roblox kamu sebelum melanjutkan.",

    fields: [
      {
        name:
          "Username",

        value:
          `@${profile.username}`,

        inline: true
      },

      {
        name:
          "Display Name",

        value:
          profile.displayName,

        inline: true
      },

      {
        name:
          "User ID",

        value:
          profile.id,

        inline: false
      }
    ]
  };

  if (profile.avatarUrl) {
    embed.thumbnail = {
      url:
        profile.avatarUrl
    };
  }

  return {
    type: 4,

    data: {
      embeds: [
        embed
      ],

      components: [
        {
          type: 1,

          components: [
            {
              type: 2,
              style: 3,

              label:
                "✅ Ya, itu saya",

              custom_id:
                `roblox-confirm:${giveawayId}:${profile.id}`
            },

            {
              type: 2,
              style: 4,

              label:
                "❌ Bukan",

              custom_id:
                `roblox-retry:${giveawayId}`
            }
          ]
        }
      ]
    }
  };
}

/* =========================================================
   SAVE ROBLOX PROFILE
========================================================= */

async function saveRobloxProfile(
  giveawayId,
  userId,
  profile,
  env
) {
  await env.DB
    .prepare(
      `
      UPDATE claims
      SET
        roblox_user_id = ?,
        roblox_username = ?,
        roblox_display_name = ?,
        roblox_avatar_url = ?,
        status = 'confirmed'
      WHERE giveaway_id = ?
      AND user_id = ?
      `
    )
    .bind(
      profile.id,
      profile.username,
      profile.displayName,
      profile.avatarUrl,
      giveawayId,
      userId
    )
    .run();
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
      new URL(request.url);

    /* =====================================================
       HOME
    ===================================================== */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return response({
        status:
          "online",

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
          await registerCommands(env);

        return response({
          success:
            true,

          commands
        });

      } catch (error) {
        return response({
          success:
            false,

          error:
            error.message
        });
      }
    }

    /* =====================================================
       DISCORD INTERACTIONS
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
          command === "giveaway"
        ) {
          const options =
            interaction.data?.options ||
            [];

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

          const creator =
            interaction.member?.user?.id ||
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
                creator,
                new Date().toISOString()
              )
              .run();

          } catch (error) {
            console.error(
              "GIVEAWAY INSERT ERROR:",
              error
            );

            return response({
              type: 4,

              data: {
                content:
                  `❌ Gagal menyimpan giveaway.\n\n\`${error.message}\``
              }
            });
          }

          /*
           * Kirim giveaway.
           */
          const giveawayMessage =
            {
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
            };

          /*
           * Simpan message ID setelah response.
           */
          ctx.waitUntil(
            (async () => {
              try {
                await new Promise(
                  resolve =>
                    setTimeout(
                      resolve,
                      700
                    )
                );

                const result =
                  await discord(
                    `/webhooks/${env.DISCORD_APPLICATION_ID}` +
                    `/${interaction.token}` +
                    `/messages/@original`,
                    env,
                    {
                      method: "GET"
                    }
                  );

                if (!result.ok) {
                  console.error(
                    "GET GIVEAWAY MESSAGE:",
                    await result.text()
                  );

                  return;
                }

                const message =
                  await result.json();

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

              } catch (error) {
                console.error(
                  "SAVE GIVEAWAY MESSAGE ERROR:",
                  error
                );
              }
            })()
          );

          return response({
            type: 4,

            data:
              giveawayMessage
          });
        }

        /* ===============================================
           /giveaway-end
        =============================================== */

        if (
          command === "giveaway-end"
        ) {
          const options =
            interaction.data?.options ||
            [];

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
            return response({
              type: 4,

              data: {
                content:
                  "❌ Giveaway tidak ditemukan."
              }
            });
          }

          const deferred =
            response({
              type: 5
            });

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
                      `✅ Giveaway \`${giveawayId}\` berhasil diakhiri dan pesannya dihapus.`
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
          command === "ticket-close"
        ) {
          const channelId =
            interaction.channel_id;

          const ticket =
            await env.DB
              .prepare(
                `
                SELECT *
                FROM claims
                WHERE channel_id = ?
                AND status != 'closed'
                LIMIT 1
                `
              )
              .bind(
                channelId
              )
              .first();

          if (!ticket) {
            return response({
              type: 4,

              data: {
                content:
                  "❌ Channel ini bukan ticket aktif."
              }
            });
          }

          await env.DB
            .prepare(
              `
              UPDATE claims
              SET status = 'closed'
              WHERE id = ?
              `
            )
            .bind(
              ticket.id
            )
            .run();

          /*
           * Hapus channel ticket.
           */
          const result =
            await discord(
              `/channels/${channelId}`,
              env,
              {
                method: "DELETE"
              }
            );

          if (!result.ok) {
            return response({
              type: 4,

              data: {
                content:
                  `❌ Gagal menghapus ticket.\n\n\`${await result.text()}\``
              }
            });
          }

          return response({
            type: 4,

            data: {
              content:
                "🔒 Ticket ditutup."
            }
          });
        }
      }

      /* ===================================================
         BUTTONS
      =================================================== */

      if (
        interaction.type === 3
      ) {
        const customId =
          interaction.data?.custom_id ||
          "";

        const user =
          interaction.member?.user ||
          interaction.user;

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
              "claim:".length
            );

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

          const existingClaim =
            await getClaim(
              giveawayId,
              user.id,
              env
            );

          if (existingClaim) {
            return response({
              type: 4,

              data: {
                content:
                  `❌ Kamu sudah memiliki ticket untuk giveaway ini.\n\n<#${existingClaim.channel_id}>`,
                flags: 64
              }
            });
          }

          /*
           * Buat ticket.
           */
          const deferred =
            response({
              type: 6
            });

          ctx.waitUntil(
            (async () => {
              try {
                const channel =
                  await createTicketChannel(
                    interaction,
                    giveaway,
                    user,
                    env
                  );

                /*
                 * INSERT CLAIM
                 *
                 * username dan display_name
                 * WAJIB diisi karena NOT NULL.
                 */
                const claimId =
                  crypto.randomUUID();

                const discordUsername =
                  user.username ||
                  `user-${user.id}`;

                const discordDisplayName =
                  user.global_name ||
                  user.username ||
                  `user-${user.id}`;

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
                      created_at,
                      channel_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `
                  )
                  .bind(
                    claimId,
                    giveawayId,
                    user.id,
                    discordUsername,
                    discordDisplayName,
                    "processing",
                    new Date().toISOString(),
                    channel.id
                  )
                  .run();

                await sendTicketMessage(
                  channel.id,
                  giveaway,
                  user,
                  env
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `🎟️ Ticket berhasil dibuat: <#${channel.id}>`
                  }
                );

              } catch (error) {
                console.error(
                  "CLAIM ERROR:",
                  error
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `❌ Gagal membuat ticket.\n\n\`${error.message}\``
                  }
                );
              }
            })()
          );

          return deferred;
        }

        /* ===============================================
           ROBLOX INPUT
        =============================================== */

        if (
          customId.startsWith(
            "roblox-input:"
          )
        ) {
          const giveawayId =
            customId.substring(
              "roblox-input:".length
            );

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

          return showRobloxModal(
            giveawayId
          );
        }

        /* ===============================================
           ROBLOX RETRY
        =============================================== */

        if (
          customId.startsWith(
            "roblox-retry:"
          )
        ) {
          const giveawayId =
            customId.substring(
              "roblox-retry:".length
            );

          return showRobloxModal(
            giveawayId
          );
        }

        /* ===============================================
           ROBLOX CONFIRM
        =============================================== */

        if (
          customId.startsWith(
            "roblox-confirm:"
          )
        ) {
          const parts =
            customId.split(":");

          const giveawayId =
            parts[1];

          const robloxId =
            parts[2];

          const claim =
            await getClaim(
              giveawayId,
              user.id,
              env
            );

          if (!claim) {
            return response({
              type: 4,

              data: {
                content:
                  "❌ Claim tidak ditemukan.",
                flags: 64
              }
            });
          }

          /*
           * Ambil profil berdasarkan ID
           * agar data yang disimpan sesuai
           * dengan preview.
           */
          const profileResult =
            await fetch(
              `${ROBLOX_API}/v1/users/${robloxId}`
            );

          if (!profileResult.ok) {
            return response({
              type: 4,

              data: {
                content:
                  "❌ Profil Roblox tidak dapat diverifikasi.",
                flags: 64
              }
            });
          }

          const robloxUser =
            await profileResult.json();

          let avatarUrl =
            claim.roblox_avatar_url ||
            null;

          try {
            const thumbnail =
              await fetch(
                `${ROBLOX_THUMBNAILS}/v1/users/avatar-headshot` +
                `?userIds=${robloxId}` +
                `&size=150x150` +
                `&format=Png` +
                `&isCircular=false`
              );

            if (thumbnail.ok) {
              const data =
                await thumbnail.json();

              avatarUrl =
                data.data?.[0]?.imageUrl ||
                avatarUrl;
            }
          } catch {}

          const profile = {
            id:
              String(
                robloxUser.id
              ),

            username:
              robloxUser.name,

            displayName:
              robloxUser.displayName,

            avatarUrl
          };

          await saveRobloxProfile(
            giveawayId,
            user.id,
            profile,
            env
          );

          return response({
            type: 4,

            data: {
              content: [
                "✅ **Roblox account berhasil dikonfirmasi!**",
                "",
                `👤 Username: **@${profile.username}**`,
                `✨ Display Name: **${profile.displayName}**`,
                `🆔 User ID: **${profile.id}**`,
                "",
                "Staff akan memproses claim kamu."
              ].join("\n"),

              embeds:
                profile.avatarUrl
                  ? [
                      {
                        thumbnail: {
                          url:
                            profile.avatarUrl
                        }
                      }
                    ]
                  : [],

              components: []
            }
          });
        }
      }

      /* ===================================================
         MODAL SUBMIT
      =================================================== */

      if (
        interaction.type === 5
      ) {
        const customId =
          interaction.data?.custom_id ||
          "";

        if (
          customId.startsWith(
            "roblox-modal:"
          )
        ) {
          const giveawayId =
            customId.substring(
              "roblox-modal:".length
            );

          const user =
            interaction.member?.user ||
            interaction.user;

          const components =
            interaction.data
              ?.components || [];

          let username = "";

          for (
            const row of components
          ) {
            for (
              const component of
              row.components || []
            ) {
              if (
                component.custom_id ===
                "roblox_username"
              ) {
                username =
                  component.value;
              }
            }
          }

          username =
            String(username || "")
              .trim()
              .replace(/^@/, "");

          if (!username) {
            return response({
              type: 4,

              data: {
                content:
                  "❌ Username Roblox kosong.",
                flags: 64
              }
            });
          }

          /*
           * Discord harus menerima response
           * dengan cepat.
           */
          const deferred =
            response({
              type: 5
            });

          ctx.waitUntil(
            (async () => {
              try {
                const profile =
                  await getRobloxProfile(
                    username
                  );

                if (!profile) {
                  await editInteraction(
                    interaction,
                    env,
                    {
                      content:
                        `❌ Username Roblox **@${username}** tidak ditemukan.`
                    }
                  );

                  return;
                }

                /*
                 * Simpan sementara hasil Roblox
                 * supaya saat confirm tersedia.
                 */
                await env.DB
                  .prepare(
                    `
                    UPDATE claims
                    SET
                      roblox_user_id = ?,
                      roblox_username = ?,
                      roblox_display_name = ?,
                      roblox_avatar_url = ?
                    WHERE giveaway_id = ?
                    AND user_id = ?
                    `
                  )
                  .bind(
                    profile.id,
                    profile.username,
                    profile.displayName,
                    profile.avatarUrl,
                    giveawayId,
                    user.id
                  )
                  .run();

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      "🎮 **Profil Roblox ditemukan.**",

                    embeds: [
                      {
                        title:
                          "Apakah ini akun Roblox Anda?",

                        description:
                          "Periksa profil di bawah.",

                        thumbnail:
                          profile.avatarUrl
                            ? {
                                url:
                                  profile.avatarUrl
                              }
                            : undefined,

                        fields: [
                          {
                            name:
                              "Username",

                            value:
                              `@${profile.username}`,

                            inline: true
                          },

                          {
                            name:
                              "Display Name",

                            value:
                              profile.displayName,

                            inline: true
                          },

                          {
                            name:
                              "User ID",

                            value:
                              profile.id,

                            inline: false
                          }
                        ]
                      }
                    ],

                    components: [
                      {
                        type: 1,

                        components: [
                          {
                            type: 2,
                            style: 3,

                            label:
                              "✅ Ya, itu saya",

                            custom_id:
                              `roblox-confirm:${giveawayId}:${profile.id}`
                          },

                          {
                            type: 2,
                            style: 4,

                            label:
                              "❌ Bukan",

                            custom_id:
                              `roblox-retry:${giveawayId}`
                          }
                        ]
                      }
                    ]
                  }
                );

              } catch (error) {
                console.error(
                  "ROBLOX MODAL ERROR:",
                  error
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `❌ Gagal mencari akun Roblox.\n\n\`${error.message}\``
                  }
                );
              }
            })()
          );

          return deferred;
        }
      }

      /* ===================================================
         UNKNOWN INTERACTION
      =================================================== */

      return response({
        type: 4,

        data: {
          content:
            "❌ Interaction tidak dikenali.",
          flags: 64
        }
      });
    }

    /* =====================================================
       NOT FOUND
    ===================================================== */

    return response({
      error:
        "Not found"
    }, 404);
  }
};
