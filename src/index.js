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
    description: "End the active giveaway"
  },
  {
    name: "ticket-close",
    description: "Close the current giveaway ticket"
  }
];


/* =========================================================
   HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}


function discordHeaders(env) {
  return {
    Authorization: `Bot ${env.DISCORD_TOKEN}`,
    "Content-Type": "application/json"
  };
}


async function discordFetch(path, env, options = {}) {
  return fetch(
    `${DISCORD_API}${path}`,
    {
      ...options,
      headers: {
        ...discordHeaders(env),
        ...(options.headers || {})
      }
    }
  );
}


async function discordJSON(path, env, options = {}) {
  const response = await discordFetch(
    path,
    env,
    options
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Discord API ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );
  }

  return data;
}


/* =========================================================
   DISCORD SIGNATURE
========================================================= */

function hexToBytes(hex) {
  const bytes = new Uint8Array(
    hex.length / 2
  );

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(
      hex.slice(i, i + 2),
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

    const message =
      new TextEncoder().encode(
        timestamp + body
      );

    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      hexToBytes(signature),
      message
    );
  } catch (error) {
    console.error(
      "Signature verification failed:",
      error
    );

    return false;
  }
}


/* =========================================================
   INTERACTION RESPONSES
========================================================= */

function messageResponse(
  content,
  components = [],
  ephemeral = false
) {
  return json({
    type: 4,
    data: {
      content,
      ...(components.length
        ? { components }
        : {}),
      ...(ephemeral
        ? { flags: 64 }
        : {})
    }
  });
}


function deferredResponse(ephemeral = false) {
  return json({
    type: 5,
    data: {
      ...(ephemeral
        ? { flags: 64 }
        : {})
    }
  });
}


function modalResponse(
  customId,
  title,
  components
) {
  return json({
    type: 9,
    data: {
      custom_id: customId,
      title,
      components
    }
  });
}


/* =========================================================
   DISCORD WEBHOOK FOLLOWUP
========================================================= */

async function editInteractionResponse(
  interaction,
  env,
  body
) {
  return discordJSON(
    `/webhooks/${env.DISCORD_APPLICATION_ID}` +
    `/${interaction.token}/messages/@original`,
    env,
    {
      method: "PATCH",
      body: JSON.stringify(body)
    }
  );
}


async function sendFollowup(
  interaction,
  env,
  body
) {
  return discordJSON(
    `/webhooks/${env.DISCORD_APPLICATION_ID}` +
    `/${interaction.token}`,
    env,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}


/* =========================================================
   COMPONENTS
========================================================= */

function claimButton(
  giveawayId,
  disabled = false
) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 1,
        label: "🎁 Claim",
        custom_id:
          `claim:${giveawayId}`,
        disabled
      }
    ]
  };
}


function confirmButtons(giveawayId) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: "✅ Confirm",
          custom_id:
            `confirm:${giveawayId}`
        },
        {
          type: 2,
          style: 2,
          label: "✏️ Edit",
          custom_id:
            `edit:${giveawayId}`
        }
      ]
    }
  ];
}


function ticketCloseButton() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 4,
          label: "🔒 Close Ticket",
          custom_id:
            "ticket_close"
        }
      ]
    }
  ];
}


/* =========================================================
   ROBLOX MODAL
========================================================= */

function robloxModal(
  giveawayId,
  displayName = "",
  username = ""
) {
  return modalResponse(
    `roblox:${giveawayId}`,
    "Roblox Giveaway Claim",
    [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id:
              "display_name",
            label:
              "Roblox Display Name",
            style: 1,
            min_length: 1,
            max_length: 32,
            required: true,
            value:
              displayName,
            placeholder:
              "Contoh: Azriel"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id:
              "username",
            label:
              "Roblox Username",
            style: 1,
            min_length: 3,
            max_length: 20,
            required: true,
            value:
              username,
            placeholder:
              "Contoh: Builderman"
          }
        ]
      }
    ]
  );
}


function collectModalValues(
  components,
  output = {}
) {
  for (const row of components || []) {
    for (
      const component of
      row.components || []
    ) {
      if (
        component.custom_id &&
        typeof component.value !==
          "undefined"
      ) {
        output[
          component.custom_id
        ] = component.value;
      }
    }
  }

  return output;
}


/* =========================================================
   USER
========================================================= */

function getUser(interaction) {
  return (
    interaction.member?.user ||
    interaction.user ||
    null
  );
}


/* =========================================================
   GET GIVEAWAY
========================================================= */

async function getGiveaway(
  giveawayId,
  env
) {
  return env.DB
    .prepare(`
      SELECT *
      FROM giveaways
      WHERE id = ?
      LIMIT 1
    `)
    .bind(giveawayId)
    .first();
}


/* =========================================================
   CREATE GIVEAWAY
========================================================= */

async function createGiveaway(
  interaction,
  env
) {
  const options =
    interaction.data?.options || [];

  const prize =
    options.find(
      x => x.name === "prize"
    )?.value;

  const winners =
    options.find(
      x => x.name === "winners"
    )?.value;

  if (
    !prize ||
    !winners
  ) {
    return messageResponse(
      "❌ Prize dan jumlah winners wajib diisi.",
      [],
      true
    );
  }

  const giveawayId =
    `GW-${crypto.randomUUID()}`;

  const user =
    getUser(interaction);

  try {
    await env.DB
      .prepare(`
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
      `)
      .bind(
        giveawayId,
        interaction.guild_id,
        interaction.channel_id,
        null,
        String(prize),
        Number(winners),
        "active",
        user?.id || "unknown",
        new Date().toISOString()
      )
      .run();

  } catch (error) {
    console.error(
      "Create giveaway DB error:",
      error
    );

    return messageResponse(
      "❌ Gagal menyimpan giveaway ke database.",
      [],
      true
    );
  }

  return messageResponse(
    [
      "🎁 **ROBUX GIVEAWAY**",
      "",
      `**Prize:** ${prize}`,
      `**Winners:** ${winners}`,
      "",
      "First come, first served.",
      "",
      "Klik tombol di bawah untuk claim."
    ].join("\n"),
    [
      claimButton(
        giveawayId
      )
    ]
  );
}


/* =========================================================
   CLAIM BUTTON
========================================================= */

async function handleClaimButton(
  interaction,
  giveawayId,
  env
) {
  /*
   * IMPORTANT:
   *
   * We don't query D1 here before responding.
   * The modal itself is the immediate response.
   *
   * This prevents:
   *
   * "This interaction failed"
   * "didn't respond in time"
   */

  return robloxModal(
    giveawayId
  );
}


/* =========================================================
   ROBLOX MODAL SUBMIT
========================================================= */

async function handleRobloxModal(
  interaction,
  giveawayId,
  env
) {
  const giveaway =
    await getGiveaway(
      giveawayId,
      env
    );

  if (!giveaway) {
    return messageResponse(
      "❌ Giveaway tidak ditemukan.",
      [],
      true
    );
  }

  if (
    giveaway.status !==
    "active"
  ) {
    return messageResponse(
      "❌ Giveaway sudah penuh atau berakhir.",
      [],
      true
    );
  }

  const user =
    getUser(interaction);

  if (!user?.id) {
    return messageResponse(
      "❌ User tidak ditemukan.",
      [],
      true
    );
  }

  const values =
    collectModalValues(
      interaction.data?.components
    );

  const displayName =
    String(
      values.display_name || ""
    ).trim();

  const username =
    String(
      values.username || ""
    ).trim();

  if (
    !displayName ||
    !username
  ) {
    return messageResponse(
      "❌ Display Name dan Username wajib diisi.",
      [],
      true
    );
  }

  /*
   * Check duplicate claim.
   */

  const existing =
    await env.DB
      .prepare(`
        SELECT *
        FROM claims
        WHERE giveaway_id = ?
          AND user_id = ?
        LIMIT 1
      `)
      .bind(
        giveawayId,
        user.id
      )
      .first();

  if (
    existing &&
    existing.status ===
      "processing"
  ) {
    return messageResponse(
      "⏳ Kamu sudah berhasil claim giveaway ini.",
      [],
      true
    );
  }

  /*
   * Check available slots.
   */

  const count =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS count
        FROM claims
        WHERE giveaway_id = ?
          AND status = 'processing'
      `)
      .bind(
        giveawayId
      )
      .first();

  const claimed =
    Number(
      count?.count || 0
    );

  if (
    claimed >=
    Number(giveaway.winners)
  ) {
    await env.DB
      .prepare(`
        UPDATE giveaways
        SET status = 'full'
        WHERE id = ?
      `)
      .bind(
        giveawayId
      )
      .run();

    return messageResponse(
      "❌ Maaf, semua slot giveaway sudah terisi.",
      [],
      true
    );
  }

  /*
   * Save pending claim.
   */

  try {
    if (existing) {
      await env.DB
        .prepare(`
          UPDATE claims
          SET
            username = ?,
            display_name = ?,
            status = 'pending'
          WHERE giveaway_id = ?
            AND user_id = ?
        `)
        .bind(
          username,
          displayName,
          giveawayId,
          user.id
        )
        .run();

    } else {
      await env.DB
        .prepare(`
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
        `)
        .bind(
          crypto.randomUUID(),
          giveawayId,
          user.id,
          username,
          displayName,
          "pending",
          new Date().toISOString()
        )
        .run();
    }

  } catch (error) {
    console.error(
      "Save claim error:",
      error
    );

    return messageResponse(
      "❌ Gagal menyimpan data claim.",
      [],
      true
    );
  }

  return messageResponse(
    [
      "📝 **CONFIRM CLAIM**",
      "",
      `🎁 **Prize:** ${giveaway.prize}`,
      "",
      `**Roblox Display Name:** ${displayName}`,
      `**Roblox Username:** ${username}`,
      "",
      "Pastikan data kamu sudah benar."
    ].join("\n"),
    confirmButtons(
      giveawayId
    ),
    true
  );
}


/* =========================================================
   EDIT CLAIM
========================================================= */

async function editClaim(
  interaction,
  giveawayId,
  env
) {
  const user =
    getUser(interaction);

  if (!user?.id) {
    return robloxModal(
      giveawayId
    );
  }

  const claim =
    await env.DB
      .prepare(`
        SELECT *
        FROM claims
        WHERE giveaway_id = ?
          AND user_id = ?
          AND status = 'pending'
        LIMIT 1
      `)
      .bind(
        giveawayId,
        user.id
      )
      .first();

  if (!claim) {
    return robloxModal(
      giveawayId
    );
  }

  return robloxModal(
    giveawayId,
    claim.display_name,
    claim.username
  );
}


/* =========================================================
   CONFIRM CLAIM
========================================================= */

async function confirmClaim(
  interaction,
  giveawayId,
  env
) {
  /*
   * Immediately defer the interaction.
   * This gives us more time to create
   * the ticket and perform DB operations.
   */

  const response =
    deferredResponse(true);

  /*
   * Continue the heavy work after
   * returning the defer response.
   */

  // We cannot execute this AFTER return
  // in normal function flow, so use waitUntil
  // from the main Worker.
  //
  // The actual work is performed by
  // processConfirmedClaim().

  return response;
}


/* =========================================================
   PROCESS CONFIRMED CLAIM
========================================================= */

async function processConfirmedClaim(
  interaction,
  env
) {
  const giveaway =
    await getGiveaway(
      interaction.__giveawayId,
      env
    );

  if (!giveaway) {
    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ Giveaway tidak ditemukan.",
        flags: 64
      }
    );
  }

  if (
    giveaway.status !==
    "active"
  ) {
    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ Giveaway sudah penuh atau berakhir.",
        flags: 64
      }
    );
  }

  const user =
    getUser(interaction);

  if (!user?.id) {
    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ User tidak ditemukan.",
        flags: 64
      }
    );
  }

  /*
   * Find pending claim.
   */

  const claim =
    await env.DB
      .prepare(`
        SELECT *
        FROM claims
        WHERE giveaway_id = ?
          AND user_id = ?
        LIMIT 1
      `)
      .bind(
        interaction.__giveawayId,
        user.id
      )
      .first();

  if (!claim) {
    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ Data claim tidak ditemukan. Silakan klik Claim lagi.",
        flags: 64
      }
    );
  }

  if (
    claim.status ===
    "processing"
  ) {
    return sendFollowup(
      interaction,
      env,
      {
        content:
          "⏳ Claim kamu sudah diproses.",
        flags: 64
      }
    );
  }

  /*
   * Re-check slots immediately before
   * assigning the winner slot.
   */

  const count =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS count
        FROM claims
        WHERE giveaway_id = ?
          AND status = 'processing'
      `)
      .bind(
        giveaway.id
      )
      .first();

  const claimed =
    Number(
      count?.count || 0
    );

  if (
    claimed >=
    Number(giveaway.winners)
  ) {
    await env.DB
      .prepare(`
        UPDATE giveaways
        SET status = 'full'
        WHERE id = ?
      `)
      .bind(
        giveaway.id
      )
      .run();

    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ Maaf, slot giveaway sudah diambil user lain.",
        flags: 64
      }
    );
  }

  /*
   * Claim slot.
   */

  const update =
    await env.DB
      .prepare(`
        UPDATE claims
        SET status = 'processing'
        WHERE giveaway_id = ?
          AND user_id = ?
          AND status = 'pending'
      `)
      .bind(
        giveaway.id,
        user.id
      )
      .run();

  if (
    !update.meta?.changes
  ) {
    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ Claim sudah diproses atau tidak tersedia.",
        flags: 64
      }
    );
  }

  /*
   * Count again.
   */

  const finalCount =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS count
        FROM claims
        WHERE giveaway_id = ?
          AND status = 'processing'
      `)
      .bind(
        giveaway.id
      )
      .first();

  const totalClaimed =
    Number(
      finalCount?.count || 0
    );

  if (
    totalClaimed >=
    Number(giveaway.winners)
  ) {
    await env.DB
      .prepare(`
        UPDATE giveaways
        SET status = 'full'
        WHERE id = ?
      `)
      .bind(
        giveaway.id
      )
      .run();
  }

  /*
   * Create private ticket.
   */

  let ticket;

  try {
    ticket =
      await createPrivateTicket(
        interaction,
        giveaway,
        claim,
        env
      );

  } catch (error) {
    console.error(
      "Ticket creation error:",
      error
    );

    /*
     * Roll claim back.
     */

    await env.DB
      .prepare(`
        UPDATE claims
        SET status = 'pending'
        WHERE giveaway_id = ?
          AND user_id = ?
          AND status = 'processing'
      `)
      .bind(
        giveaway.id,
        user.id
      )
      .run();

    return sendFollowup(
      interaction,
      env,
      {
        content:
          "❌ Claim tersimpan, tetapi ticket gagal dibuat. Coba Confirm lagi.",
        flags: 64
      }
    );
  }

  return sendFollowup(
    interaction,
    env,
    {
      content:
        [
          "✅ **CLAIM BERHASIL!**",
          "",
          `🎁 **Prize:** ${giveaway.prize}`,
          `👤 **Roblox Display Name:** ${claim.display_name}`,
          `👤 **Roblox Username:** ${claim.username}`,
          "",
          "⏳ **Processing**",
          "Mohon tunggu hingga **24 jam**.",
          "",
          `🎫 Ticket: <#${ticket.channel_id}>`
        ].join("\n"),
      flags: 64
    }
  );
}


/* =========================================================
   CREATE PRIVATE TICKET
========================================================= */

async function createPrivateTicket(
  interaction,
  giveaway,
  claim,
  env
) {
  const guildId =
    interaction.guild_id;

  const userId =
    claim.user_id;

  /*
   * Check existing ticket.
   */

  const existing =
    await env.DB
      .prepare(`
        SELECT *
        FROM tickets
        WHERE giveaway_id = ?
          AND user_id = ?
          AND status = 'open'
        LIMIT 1
      `)
      .bind(
        giveaway.id,
        userId
      )
      .first();

  if (existing) {
    return {
      channel_id:
        existing.channel_id
    };
  }

  /*
   * Discord permission bits.
   */

  const VIEW_CHANNEL = 1024;
  const SEND_MESSAGES = 2048;
  const READ_HISTORY = 65536;

  const ticketPermissions =
    VIEW_CHANNEL |
    SEND_MESSAGES |
    READ_HISTORY;

  /*
   * Create channel.
   */

  const channel =
    await discordJSON(
      `/guilds/${guildId}/channels`,
      env,
      {
        method: "POST",

        body: JSON.stringify({
          name:
            `claim-${String(
              claim.username
            )
              .toLowerCase()
              .replace(
                /[^a-z0-9-]/g,
                "-"
              )
              .slice(0, 40)}`,

          type: 0,

          parent_id:
            env.DISCORD_TICKET_CATEGORY_ID,

          permission_overwrites: [
            /*
             * @everyone
             */
            {
              id: guildId,
              type: 0,
              allow: "0",
              deny:
                String(
                  VIEW_CHANNEL
                )
            },

            /*
             * Claimant
             */
            {
              id: userId,
              type: 1,
              allow:
                String(
                  ticketPermissions
                ),
              deny: "0"
            },

            /*
             * Staff role
             */
            {
              id:
                env.DISCORD_STAFF_ROLE_ID,
              type: 0,
              allow:
                String(
                  ticketPermissions
                ),
              deny: "0"
            }
          ]
        })
      }
    );

  /*
   * Save ticket.
   */

  const ticketId =
    crypto.randomUUID();

  await env.DB
    .prepare(`
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
    `)
    .bind(
      ticketId,
      giveaway.id,
      claim.id,
      userId,
      channel.id,
      "open",
      new Date().toISOString()
    )
    .run();

  /*
   * Send ticket message.
   */

  await discordJSON(
    `/channels/${channel.id}/messages`,
    env,
    {
      method: "POST",

      body: JSON.stringify({
        content:
          [
            "🎫 **GIVEAWAY CLAIM TICKET**",
            "",
            `👤 **User:** <@${userId}>`,
            `🎁 **Prize:** ${giveaway.prize}`,
            "",
            `**Roblox Display Name:** ${claim.display_name}`,
            `**Roblox Username:** ${claim.username}`,
            "",
            "⏳ **Status:** Processing",
            "",
            "Staff akan memproses claim ini.",
            "Mohon tunggu hingga 24 jam."
          ].join("\n"),

        components:
          ticketCloseButton()
      })
    }
  );

  return {
    channel_id:
      channel.id
  };
}


/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(
  interaction,
  env
) {
  const channelId =
    interaction.channel_id;

  const ticket =
    await env.DB
      .prepare(`
        SELECT *
        FROM tickets
        WHERE channel_id = ?
          AND status = 'open'
        LIMIT 1
      `)
      .bind(
        channelId
      )
      .first();

  if (!ticket) {
    return messageResponse(
      "❌ Channel ini bukan ticket giveaway aktif.",
      [],
      true
    );
  }

  const user =
    getUser(interaction);

  const roles =
    interaction.member?.roles || [];

  const isStaff =
    roles.includes(
      env.DISCORD_STAFF_ROLE_ID
    );

  if (
    user?.id !== ticket.user_id &&
    !isStaff
  ) {
    return messageResponse(
      "❌ Hanya claimant atau Staff yang dapat menutup ticket.",
      [],
      true
    );
  }

  await env.DB
    .prepare(`
      UPDATE tickets
      SET status = 'closed'
      WHERE id = ?
    `)
    .bind(
      ticket.id
    )
    .run();

  /*
   * Delete channel after responding.
   */

  return messageResponse(
    "🔒 Ticket ditutup."
  );
}


/* =========================================================
   END GIVEAWAY
========================================================= */

async function endGiveaway(
  interaction,
  env
) {
  const roles =
    interaction.member?.roles || [];

  const isStaff =
    roles.includes(
      env.DISCORD_STAFF_ROLE_ID
    );

  if (!isStaff) {
    return messageResponse(
      "❌ Hanya Staff yang dapat mengakhiri giveaway.",
      [],
      true
    );
  }

  const giveaway =
    await env.DB
      .prepare(`
        SELECT *
        FROM giveaways
        WHERE channel_id = ?
          AND status IN ('active', 'full')
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(
        interaction.channel_id
      )
      .first();

  if (!giveaway) {
    return messageResponse(
      "❌ Tidak ada giveaway aktif di channel ini.",
      [],
      true
    );
  }

  await env.DB
    .prepare(`
      UPDATE giveaways
      SET status = 'ended'
      WHERE id = ?
    `)
    .bind(
      giveaway.id
    )
    .run();

  return messageResponse(
    `🔒 Giveaway \`${giveaway.id}\` telah diakhiri.`
  );
}


/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands(env) {
  if (
    !env.DISCORD_TOKEN ||
    !env.DISCORD_APPLICATION_ID ||
    !env.DISCORD_GUILD_ID
  ) {
    throw new Error(
      "Discord configuration incomplete."
    );
  }

  return discordJSON(
    `/applications/${env.DISCORD_APPLICATION_ID}` +
    `/guilds/${env.DISCORD_GUILD_ID}` +
    `/commands`,
    env,
    {
      method: "PUT",
      body:
        JSON.stringify(
          COMMANDS
        )
    }
  );
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


    /* -----------------------------------------------------
       HOME
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       DEBUG
    ----------------------------------------------------- */

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
          Boolean(
            env.DB
          )
      });
    }


    /* -----------------------------------------------------
       REGISTER
    ----------------------------------------------------- */

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
          message:
            "Discord slash commands registered.",
          commands
        });

      } catch (error) {
        return json(
          {
            success: false,
            error:
              error.message
          },
          500
        );
      }
    }


    /* -----------------------------------------------------
       DISCORD INTERACTIONS
    ----------------------------------------------------- */

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


      /* PING */

      if (
        interaction.type === 1
      ) {
        return json({
          type: 1
        });
      }


      /* SLASH COMMAND */

      if (
        interaction.type === 2
      ) {
        const command =
          interaction.data?.name;

        if (
          command ===
          "giveaway"
        ) {
          return createGiveaway(
            interaction,
            env
          );
        }

        if (
          command ===
          "giveaway-end"
        ) {
          return endGiveaway(
            interaction,
            env
          );
        }

        if (
          command ===
          "ticket-close"
        ) {
          return closeTicket(
            interaction,
            env
          );
        }

        return messageResponse(
          "❌ Command tidak dikenal.",
          [],
          true
        );
      }


      /* BUTTON */

      if (
        interaction.type === 3
      ) {
        const customId =
          interaction.data?.custom_id ||
          "";

        /*
         * CLAIM
         *
         * Immediately return modal.
         */

        if (
          customId.startsWith(
            "claim:"
          )
        ) {
          const giveawayId =
            customId.slice(
              "claim:".length
            );

          return handleClaimButton(
            interaction,
            giveawayId,
            env
          );
        }


        /*
         * CONFIRM
         *
         * Immediately defer.
         */

        if (
          customId.startsWith(
            "confirm:"
          )
        ) {
          const giveawayId =
            customId.slice(
              "confirm:".length
            );

          /*
           * Attach giveaway ID so
           * background processing knows it.
           */

          interaction.__giveawayId =
            giveawayId;

          /*
           * IMPORTANT:
           * return response immediately.
           */

          const response =
            deferredResponse(true);

          /*
           * Process after response.
           */

          ctx.waitUntil(
            processConfirmedClaim(
              interaction,
              env
            )
          );

          return response;
        }


        /*
         * EDIT
         */

        if (
          customId.startsWith(
            "edit:"
          )
        ) {
          const giveawayId =
            customId.slice(
              "edit:".length
            );

          return editClaim(
            interaction,
            giveawayId,
            env
          );
        }


        /*
         * CLOSE TICKET
         */

        if (
          customId ===
          "ticket_close"
        ) {
          return closeTicket(
            interaction,
            env
          );
        }

        return messageResponse(
          "❌ Button tidak dikenal.",
          [],
          true
        );
      }


      /* MODAL SUBMIT */

      if (
        interaction.type === 5
      ) {
        const customId =
          interaction.data?.custom_id ||
          "";

        if (
          customId.startsWith(
            "roblox:"
          )
        ) {
          const giveawayId =
            customId.slice(
              "roblox:".length
            );

          return handleRobloxModal(
            interaction,
            giveawayId,
            env
          );
        }

        return messageResponse(
          "❌ Form tidak dikenal.",
          [],
          true
        );
      }


      return messageResponse(
        "❌ Interaction tidak didukung.",
        [],
        true
      );
    }


    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};
