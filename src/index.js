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
   GET GIVEAWAY
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
      .slice(0, 45);

  /*
   * VIEW_CHANNEL
   * SEND_MESSAGES
   * READ_MESSAGE_HISTORY
   */
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
              `👤 Discord: <@${user.id}>`,
              `🎁 Prize: **${giveaway.prize}**`,
              `🏆 Winners: **${giveaway.winners}**`,
              "",
              "Silakan masukkan username Roblox kamu.",
              "",
              "Format:",
              "`nanazpine` atau `@nanazpine`",
              "",
              "Tekan tombol di bawah untuk melanjutkan."
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

  const text =
    await result.text();

  if (!result.ok) {
    throw new Error(
      `Send ticket message failed: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
   GET ORIGINAL INTERACTION MESSAGE
========================================================= */

async function getOriginalInteractionMessage(
  interaction,
  env
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
        method: "GET"
      }
    );

  if (!result.ok) {
    throw new Error(
      `Get giveaway message failed: ${await result.text()}`
    );
  }

  return result.json();
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
  /*
   * Terima:
   *
   * nanazpine
   * @nanazpine
   *
   * Keduanya diproses menjadi:
   *
   * nanazpine
   */

  const cleanUsername =
    String(username || "")
      .trim()
      .replace(/^@+/, "");

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
            usernames:
              [cleanUsername],

            excludeBannedUsers:
              false
          })
      }
    );

  if (!lookup.ok) {
    console.error(
      "ROBLOX LOOKUP:",
      lookup.status,
      await lookup.text()
    );

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

  let avatarUrl =
    null;

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
                "Contoh: nanazpine"
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
      "Periksa profil di bawah sebelum melanjutkan claim.",

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
          await registerCommands(
            env
          );

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
           * Simpan giveaway.
           *
           * message_id sementara NULL.
           * Setelah Discord membuat message,
           * kita ambil message ID dan UPDATE D1.
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
           * Response giveaway.
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
           * Setelah interaction response dikirim,
           * ambil original message dan simpan ID.
           */

          ctx.waitUntil(
            (async () => {
              try {
                await new Promise(
                  resolve =>
                    setTimeout(
                      resolve,
                      500
                    )
                );

                const message =
                  await getOriginalInteractionMessage(
                    interaction,
                    env
                  );

                if (
                  message?.id
                ) {
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
                }

              } catch (error) {
                console.error(
                  "SAVE GIVEAWAY MESSAGE ID ERROR:",
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
          command ===
          "giveaway-end"
        ) {
          const options =
            interaction.data
              ?.options || [];

          const giveawayId =
            options.find(
              x =>
                x.name ===
                "id"
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
           CLAIM BUTTON
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
                  `❌ Kamu sudah melakukan claim giveaway ini.\n\nTicket: <#${existingClaim.channel_id}>`,

                flags: 64
              }
            });
          }

          /*
           * Buat ticket.
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
                const ticket =
                  await createTicketChannel(
                    interaction,
                    giveaway,
                    user,
                    env
                  );

                /*
                 * Simpan claim.
                 */

                const claimId =
                  crypto.randomUUID();

                await env.DB
                  .prepare(
                    `
                    INSERT INTO claims (
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
                    claimId,
                    giveawayId,
                    user.id,
                    ticket.id,
                    "pending",
                    new Date().toISOString()
                  )
                  .run();

                /*
                 * Simpan ticket.
                 */

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
                    claimId,
                    giveawayId,
                    user.id,
                    ticket.id,
                    "open",
                    new Date().toISOString()
                  )
                  .run();

                /*
                 * Kirim pesan pertama.
                 */

                await sendTicketMessage(
                  ticket.id,
                  giveaway,
                  user,
                  env
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `🎟️ Ticket berhasil dibuat: <#${ticket.id}>`
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
           ROBLOX INPUT BUTTON
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
                 * Ambil ulang profil berdasarkan ID
                 * supaya data tidak bisa dimanipulasi
                 * dari custom_id.
                 */

                const lookup =
                  await fetch(
                    `${ROBLOX_API}/v1/users/${robloxId}`
                  );

                if (!lookup.ok) {
                  throw new Error(
                    "Profil Roblox tidak dapat diverifikasi."
                  );
                }

                const robloxUser =
                  await lookup.json();

                let avatarUrl =
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

                  if (
                    thumbnail.ok
                  ) {
                    const thumbnailData =
                      await thumbnail.json();

                    avatarUrl =
                      thumbnailData.data?.[0]?.imageUrl ||
                      null;
                  }
                } catch {}

                const profile = {
                  id:
                    String(robloxUser.id),

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

                await discord(
                  `/channels/${claim.channel_id}/messages`,
                  env,
                  {
                    method: "POST",

                    body:
                      JSON.stringify({
                        content: [
                          "✅ **Roblox Account Confirmed**",
                          "",
                          `👤 Discord: <@${user.id}>`,
                          `🎮 Username: **@${profile.username}**`,
                          `✨ Display Name: **${profile.displayName}**`,
                          `🆔 Roblox ID: **${profile.id}**`,
                          "",
                          "⏳ Claim kamu sudah dikirim ke staff.",
                          "Silakan tunggu proses pemberian Robux."
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
                            : []
                      })
                  }
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      "✅ Akun Roblox berhasil dikonfirmasi."
                  }
                );

              } catch (error) {
                console.error(
                  "ROBLOX CONFIRM ERROR:",
                  error
                );

                await editInteraction(
                  interaction,
                  env,
                  {
                    content:
                      `❌ Gagal memverifikasi akun Roblox.\n\n\`${error.message}\``
                  }
                );
              }
            })()
          );

          return deferred;
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

        /* ===============================================
           ROBLOX MODAL SUBMIT
        =============================================== */

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
                  component.value ||
                  "";
              }
            }
          }

          /*
           * Bersihkan username.
           *
           * @nanazpine
           * menjadi:
           *
           * nanazpine
           */

          const cleanUsername =
            String(username)
              .trim()
              .replace(/^@+/, "");

          if (
            !cleanUsername
          ) {
            return response({
              type: 4,

              data: {
                content:
                  "❌ Username Roblox kosong.",

                flags: 64
              }
            });
          }

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
                const profile =
                  await getRobloxProfile(
                    cleanUsername
                  );

                if (!profile) {
                  await editInteraction(
                    interaction,
                    env,
                    {
                      content:
                        `❌ Username Roblox **@${cleanUsername}** tidak ditemukan.\n\nPastikan username benar, lalu coba lagi.`
                    }
                  );

                  return;
                }

                /*
                 * Tampilkan preview.
                 */

                const preview =
                  robloxPreview(
                    profile,
                    giveawayId
                  );

                await editInteraction(
                  interaction,
                  env,
                  preview.data
                );

              } catch (error) {
                console.error(
                  "ROBLOX SEARCH ERROR:",
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
            "❌ Interaksi tidak dikenali.",

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
