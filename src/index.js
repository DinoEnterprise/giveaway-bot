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
  const bytes = new Uint8Array(
    hex.length / 2
  );

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
   REGISTER COMMANDS
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
        body:
          JSON.stringify(COMMANDS)
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

  const discordUsername =
    user.username ||
    `user-${user.id}`;

  const safeName =
    discordUsername
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
      id:
        env.DISCORD_APPLICATION_ID,
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
   CREATE CLAIM
   IMPORTANT:
   Tidak memakai channel_id karena schema claims kamu
   tidak memiliki kolom channel_id.
========================================================= */

async function createClaim(
  giveawayId,
  user,
  env
) {
  const existing =
    await getClaim(
      giveawayId,
      user.id,
      env
    );

  if (existing) {
    return existing;
  }

  const username =
    user.username ||
    `user-${user.id}`;

  const claimId =
    crypto.randomUUID();

  await env.DB
    .prepare(
      `
      INSERT INTO claims (
        id,
        giveaway_id,
        user_id,
        username,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      claimId,
      giveawayId,
      user.id,
      username,
      "open",
      new Date().toISOString()
    )
    .run();

  return await getClaim(
    giveawayId,
    user.id,
    env
  );
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
              `👤 Discord: <@${user.id}>`,
              `🎁 Prize: **${giveaway.prize}**`,
              `🏆 Winners: **${giveaway.winners}**`,
              "",
              "### 🎮 Verifikasi Roblox",
              "",
              "Silakan masukkan username Roblox kamu.",
              "Bot akan menampilkan preview profil Roblox sebelum claim dilanjutkan."
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

  return await result.json();
}

/* =========================================================
   EDIT ORIGINAL INTERACTION
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
   DELETE GIVEAWAY
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
   GET ORIGINAL GIVEAWAY MESSAGE
========================================================= */

async function getOriginalGiveawayMessage(
  interaction,
  env
) {
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
    throw new Error(
      `Get giveaway message failed: ${await result.text()}`
    );
  }

  return await result.json();
}

/* =========================================================
   ROBLOX PROFILE BY USERNAME
========================================================= */

async function getRobloxProfile(
  username
) {
  const cleanUsername =
    String(username)
      .trim()
      .replace(/^@/, "");

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
      `Roblox API error ${lookup.status}`
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

  return await getRobloxProfileById(
    user.id
  );
}

/* =========================================================
   ROBLOX PROFILE BY ID
========================================================= */

async function getRobloxProfileById(
  userId
) {
  const userResponse =
    await fetch(
      `${ROBLOX_API}/v1/users/${userId}`
    );

  if (!userResponse.ok) {
    return null;
  }

  const user =
    await userResponse.json();

  const thumbnail =
    await fetch(
      `${ROBLOX_THUMBNAILS}/v1/users/avatar-headshot` +
      `?userIds=${user.id}` +
      `&size=150x150` +
      `&format=Png` +
      `&isCircular=false`
    );

  let avatarUrl = null;

  if (thumbnail.ok) {
    const thumbnailData =
      await thumbnail.json();

    avatarUrl =
      thumbnailData.data?.[0]?.imageUrl ||
      null;
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
                "Contoh: builderman"
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
      "Periksa profil berikut sebelum melanjutkan claim.",

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
                "❌ Bukan, ganti username",

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
  const result =
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

  return result;
}

/* =========================================================
   DELETE CURRENT CHANNEL
========================================================= */

async function deleteChannel(
  channelId,
  env
) {
  const result =
    await discord(
      `/channels/${channelId}`,
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
      `Delete ticket failed: ${await result.text()}`
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
         SLASH COMMANDS
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

          const creator =
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
           * Response langsung.
           */
          const result =
            response({
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

          /*
           * Ambil message ID setelah
           * response dibuat Discord.
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

                const message =
                  await discord(
                    `/webhooks/${env.DISCORD_APPLICATION_ID}` +
                    `/${interaction.token}` +
                    `/messages/@original`,
                    env,
                    {
                      method:
                        "GET"
                    }
                  );

                if (!message.ok) {
                  console.error(
                    "GET GIVEAWAY MESSAGE:",
                    await message.text()
                  );

                  return;
                }

                const messageData =
                  await message.json();

                await env.DB
                  .prepare(
                    `
                    UPDATE giveaways
                    SET message_id = ?
                    WHERE id = ?
                    `
                  )
                  .bind(
                    messageData.id,
                    giveawayId
                  )
                  .run();

              } catch (error) {
                console.error(
                  "SAVE GIVEAWAY MESSAGE ID:",
                  error
                );
              }
            })()
          );

          return result;
        }

        /* ===============================================
           /giveaway-end
        =============================================== */

        if (
          command === "giveaway-end"
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
                      `✅ Giveaway \`${giveawayId}\` berhasil diakhiri dan pesan giveaway telah dihapus.`
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
                /*
                 * Cari ticket berdasarkan topic channel.
                 */
                const channel =
                  await discord(
                    `/channels/${channelId}`,
                    env,
                    {
                      method:
                        "GET"
                    }
                  );

                if (!channel.ok) {
                  throw new Error(
                    "Channel tidak ditemukan."
                  );
                }

                const channelData =
                  await channel.json();

                const topic =
                  channelData.topic ||
                  "";

                if (
                  !topic.startsWith(
                    "Giveaway "
                  )
                ) {
                  await editInteraction(
                    interaction,
                    env,
                    {
                      content:
                        "❌ Channel ini bukan ticket giveaway."
                    }
                  );

                  return;
                }

                /*
                 * Tutup claim jika ada.
                 */
                const userMatch =
                  topic.match(
                    /User (\d+)/
                  );

                if (userMatch) {
                  const userId =
                    userMatch[1];

                  const giveawayMatch =
                    topic.match(
                      /Giveaway (GW-[^ ]+)/
                    );

                  if (
                    giveawayMatch
                  ) {
                    await env.DB
                      .prepare(
                        `
                        UPDATE claims
                        SET status = 'closed'
                        WHERE giveaway_id = ?
                        AND user_id = ?
                        `
                      )
                      .bind(
                        giveawayMatch[1],
                        userId
                      )
                      .run();
                  }
                }

                /*
                 * Hapus channel ticket.
                 */
                await deleteChannel(
                  channelId,
                  env
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
                      `❌ Gagal menutup ticket.\n\n\`${error.message}\``
                  }
                );
              }
            })()
          );

          return deferred;
        }
      }

      /* ===================================================
         BUTTONS
      =================================================== */

      if (
        interaction.type === 3
      ) {
        const customId =
          interaction.data
            ?.custom_id || "";

        const user =
          interaction.member
            ?.user ||
          interaction.user;

        /* ===============================================
           CLAIM GIVEAWAY
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
                  "❌ Giveaway ini sudah berakhir.",
                flags: 64
              }
            });
          }

          const existing =
            await getClaim(
              giveawayId,
              user.id,
              env
            );

          if (existing) {
            return response({
              type: 4,

              data: {
                content:
                  "⚠️ Kamu sudah memiliki ticket untuk giveaway ini.",
                flags: 64
              }
            });
          }

          /*
           * Discord harus mendapat response
           * dalam 3 detik.
           */
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
                /*
                 * Buat claim dulu.
                 *
                 * username WAJIB diisi karena
                 * schema D1 kamu NOT NULL.
                 */
                await createClaim(
                  giveawayId,
                  user,
                  env
                );

                /*
                 * Buat ticket.
                 */
                const ticket =
                  await createTicketChannel(
                    interaction,
                    giveaway,
                    user,
                    env
                  );

                /*
                 * Kirim pesan ticket.
                 */
                await sendTicketMessage(
                  ticket.id,
                  giveaway,
                  user,
                  env
                );

                /*
                 * Simpan channel ID di tabel tickets
                 * jika tabel tickets tersedia.
                 */
                try {
                  await env.DB
                    .prepare(
                      `
                      INSERT INTO tickets (
                        id,
                        giveaway_id,
                        user_id,
                        channel_id,
                        status,
                        created_at
                      )
                      VALUES (?, ?, ?, ?, ?, ?)
                      `
                    )
                    .bind(
                      crypto.randomUUID(),
                      giveawayId,
                      user.id,
                      ticket.id,
                      "open",
                      new Date().toISOString()
                    )
                    .run();

                } catch (ticketDbError) {
                  /*
                   * Jangan hapus ticket hanya karena
                   * struktur tickets berbeda.
                   */
                  console.error(
                    "TICKET D1 WARNING:",
                    ticketDbError
                  );
                }

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `✅ Ticket berhasil dibuat: <#${ticket.id}>`
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

          /*
           * Ambil profil Roblox lagi
           * berdasarkan User ID.
           */
          const profile =
            await getRobloxProfileById(
              robloxId
            );

          if (!profile) {
            return response({
              type: 4,

              data: {
                content:
                  "❌ Profil Roblox tidak dapat ditemukan lagi. Silakan ulangi.",
                flags: 64
              }
            });
          }

          try {
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
                  "✅ **Roblox berhasil dikonfirmasi!**",
                  "",
                  `👤 Username: **@${profile.username}**`,
                  `📛 Display Name: **${profile.displayName}**`,
                  `🆔 User ID: **${profile.id}**`,
                  "",
                  "🎁 Data claim sudah tersimpan.",
                  "Silakan tunggu staff memproses hadiah."
                ].join("\n"),

                embeds:
                  profile.avatarUrl
                    ? [
                        {
                          title:
                            "Roblox Profile",
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

          } catch (error) {
            console.error(
              "SAVE ROBLOX ERROR:",
              error
            );

            return response({
              type: 4,

              data: {
                content:
                  `❌ Gagal menyimpan data Roblox.\n\n\`${error.message}\``,
                flags: 64
              }
            });
          }
        }
      }

      /* ===================================================
         MODAL SUBMIT
      =================================================== */

      if (
        interaction.type === 5
      ) {
        const customId =
          interaction.data
            ?.custom_id || "";

        if (
          customId.startsWith(
            "roblox-modal:"
          )
        ) {
          const giveawayId =
            customId.substring(
              "roblox-modal:".length
            );

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
           * Bersihkan @ jika user mengetik
           * @Username.
           */
          username =
            String(username)
              .trim()
              .replace(
                /^@/,
                ""
              );

          try {
            const profile =
              await getRobloxProfile(
                username
              );

            if (!profile) {
              return response({
                type: 4,

                data: {
                  content:
                    `❌ Username Roblox **@${username}** tidak ditemukan.\n\nPastikan username yang dimasukkan adalah **username asli Roblox**, bukan Display Name.`,
                  flags: 64
                }
              });
            }

            return robloxPreview(
              profile,
              giveawayId
            );

          } catch (error) {
            console.error(
              "ROBLOX LOOKUP ERROR:",
              error
            );

            return response({
              type: 4,

              data: {
                content:
                  `❌ Gagal mencari akun Roblox.\n\n\`${error.message}\``,
                flags: 64
              }
            });
          }
        }
      }

      return response({
        type: 4,

        data: {
          content:
            "❌ Interaction tidak dikenali.",
          flags: 64
        }
      });
    }

    return response({
      status:
        "not_found"
    }, 404);
  }
};
