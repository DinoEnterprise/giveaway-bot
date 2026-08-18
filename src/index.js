const DISCORD_API = "https://discord.com/api/v10";

/*
|--------------------------------------------------------------------------
| COMMANDS
|--------------------------------------------------------------------------
*/

const COMMANDS = [
  {
    name: "giveaway",
    description: "Create a new Robux giveaway",

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
    description: "End the active giveaway in this channel"
  },

  {
    name: "ticket-close",
    description: "Close the current giveaway ticket"
  }
];


/*
|--------------------------------------------------------------------------
| DISCORD PERMISSIONS
|--------------------------------------------------------------------------
|
| VIEW_CHANNEL          = 1024
| SEND_MESSAGES         = 2048
| READ_MESSAGE_HISTORY  = 65536
|
*/

const PERM_VIEW =
  1024n;

const PERM_SEND =
  2048n;

const PERM_HISTORY =
  65536n;

const PERM_TICKET =
  PERM_VIEW |
  PERM_SEND |
  PERM_HISTORY;


/*
|--------------------------------------------------------------------------
| BASIC HELPERS
|--------------------------------------------------------------------------
*/

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}


function discordHeaders(env) {
  return {
    "Authorization":
      `Bot ${env.DISCORD_TOKEN}`,

    "Content-Type":
      "application/json"
  };
}


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
        ...discordHeaders(env),
        ...(options.headers || {})
      }
    }
  );
}


async function discordJSON(
  path,
  env,
  options = {}
) {
  const response =
    await discordFetch(
      path,
      env,
      options
    );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
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


/*
|--------------------------------------------------------------------------
| HEX → BYTES
|--------------------------------------------------------------------------
*/

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
        hex.slice(i, i + 2),
        16
      );
  }

  return bytes;
}


/*
|--------------------------------------------------------------------------
| DISCORD SIGNATURE
|--------------------------------------------------------------------------
*/

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


/*
|--------------------------------------------------------------------------
| INTERACTION RESPONSES
|--------------------------------------------------------------------------
*/

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
        ? {
            components
          }
        : {}),

      ...(ephemeral
        ? {
            flags: 64
          }
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
      custom_id:
        customId,

      title,

      components
    }
  });
}


/*
|--------------------------------------------------------------------------
| BUTTONS
|--------------------------------------------------------------------------
*/

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


function confirmButtons(
  giveawayId
) {
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


/*
|--------------------------------------------------------------------------
| ROBLOX FORM
|--------------------------------------------------------------------------
*/

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
              displayName || "",

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
              username || "",

            placeholder:
              "Contoh: Builderman"
          }
        ]
      }
    ]
  );
}


/*
|--------------------------------------------------------------------------
| EXTRACT MODAL INPUTS
|--------------------------------------------------------------------------
*/

function collectModalValues(
  components,
  output = {}
) {
  for (
    const row of components || []
  ) {
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

      if (
        component.components
      ) {
        collectModalValues(
          component.components,
          output
        );
      }
    }

    if (row.component) {
      collectModalValues(
        [row.component],
        output
      );
    }
  }

  return output;
}


/*
|--------------------------------------------------------------------------
| GET USER
|--------------------------------------------------------------------------
*/

function getUser(interaction) {
  return (
    interaction.member?.user ||
    interaction.user ||
    null
  );
}


/*
|--------------------------------------------------------------------------
| GIVEAWAY
|--------------------------------------------------------------------------
*/

async function createGiveaway(
  interaction,
  env,
  ctx
) {
  const options =
    interaction.data?.options ||
    [];

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
    `GW-${crypto
      .randomUUID()
      .slice(0, 8)}`;

  const createdAt =
    new Date().toISOString();

  const user =
    getUser(interaction);

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

      createdAt
    )
    .run();


  /*
  | Save the Discord message ID after the
  | initial interaction response is created.
  */

  ctx.waitUntil(
    saveOriginalMessageId(
      interaction,
      giveawayId,
      env
    )
  );


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


/*
|--------------------------------------------------------------------------
| SAVE ORIGINAL MESSAGE ID
|--------------------------------------------------------------------------
*/

async function saveOriginalMessageId(
  interaction,
  giveawayId,
  env
) {
  try {
    const message =
      await discordJSON(
        `/webhooks/${env.DISCORD_APPLICATION_ID}` +
        `/${interaction.token}/messages/@original`,
        env
      );

    if (message?.id) {
      await env.DB
        .prepare(`
          UPDATE giveaways
          SET message_id = ?
          WHERE id = ?
        `)
        .bind(
          message.id,
          giveawayId
        )
        .run();
    }

  } catch (error) {
    console.error(
      "Could not save giveaway message ID:",
      error
    );
  }
}


/*
|--------------------------------------------------------------------------
| UPDATE GIVEAWAY MESSAGE
|--------------------------------------------------------------------------
*/

async function disableGiveawayButton(
  giveaway,
  interaction,
  env
) {
  const messageId =
    giveaway.message_id ||
    interaction.message?.id;

  if (!messageId) {
    return;
  }

  try {

    await discordJSON(
      `/channels/${giveaway.channel_id}` +
      `/messages/${messageId}`,

      env,

      {
        method: "PATCH",

        body:
          JSON.stringify({
            components:
              [
                claimButton(
                  giveaway.id,
                  true
                )
              ]
          })
      }
    );

  } catch (error) {

    console.error(
      "Failed to disable giveaway button:",
      error
    );

  }
}


/*
|--------------------------------------------------------------------------
| GET GIVEAWAY
|--------------------------------------------------------------------------
*/

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


/*
|--------------------------------------------------------------------------
| CLAIM BUTTON
|--------------------------------------------------------------------------
*/

async function handleClaimButton(
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
      "❌ Giveaway ini sudah penuh atau sudah berakhir.",
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


  /*
  | Check existing claim.
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
    existing?.status ===
    "processing"
  ) {
    return messageResponse(
      "⏳ Kamu sudah melakukan claim untuk giveaway ini.",
      [],
      true
    );
  }


  /*
  | Check available slots.
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

    await disableGiveawayButton(
      giveaway,
      interaction,
      env
    );

    return messageResponse(
      "❌ Semua slot giveaway sudah terisi.",
      [],
      true
    );
  }


  /*
  | If a pending claim exists, reopen it
  | for editing.
  */

  if (
    existing?.status ===
    "pending"
  ) {
    return robloxModal(
      giveawayId,

      existing.display_name ||
        "",

      existing.username ||
        ""
    );
  }


  return robloxModal(
    giveawayId
  );
}


/*
|--------------------------------------------------------------------------
| MODAL SUBMISSION
|--------------------------------------------------------------------------
*/

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
      values.display_name ||
        ""
    ).trim();

  const username =
    String(
      values.username ||
        ""
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
  | Save as pending.
  |
  | UNIQUE(giveaway_id, user_id)
  | prevents duplicate pending records.
  */

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

      ON CONFLICT(giveaway_id, user_id)
      DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        status = 'pending'
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


  return messageResponse(

    [
      "📝 **Confirm Claim**",
      "",
      `**Prize:** ${giveaway.prize}`,
      "",
      `**Roblox Display Name:** ${displayName}`,
      `**Roblox Username:** ${username}`,
      "",
      "Pastikan data sudah benar."
    ].join("\n"),

    confirmButtons(
      giveawayId
    ),

    true
  );
}


/*
|--------------------------------------------------------------------------
| CONFIRM CLAIM
|--------------------------------------------------------------------------
*/

async function confirmClaim(
  interaction,
  giveawayId,
  env
) {
  const user =
    getUser(interaction);

  if (!user?.id) {
    return messageResponse(
      "❌ User tidak ditemukan.",
      [],
      true
    );
  }


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
        giveawayId,
        user.id
      )
      .first();


  if (!claim) {
    return messageResponse(
      "❌ Data claim tidak ditemukan. Silakan klik Claim lagi.",
      [],
      true
    );
  }


  if (
    claim.status ===
    "processing"
  ) {
    return messageResponse(
      "⏳ Claim kamu sudah diproses.",
      [],
      true
    );
  }


  /*
  | IMPORTANT:
  |
  | D1 batch() executes statements sequentially
  | in a transaction. This protects the
  | first-come-first-served slot allocation.
  */

  const result =
    await env.DB.batch([

      env.DB.prepare(`
        UPDATE giveaways
        SET status =
          CASE
            WHEN (
              SELECT COUNT(*)
              FROM claims
              WHERE giveaway_id = ?
                AND status = 'processing'
            ) + 1 >= winners
            THEN 'full'
            ELSE 'active'
          END
        WHERE id = ?
          AND status = 'active'
          AND (
            SELECT COUNT(*)
            FROM claims
            WHERE giveaway_id = ?
              AND status = 'processing'
          ) < winners
      `).bind(
        giveawayId,
        giveawayId,
        giveawayId
      ),

      env.DB.prepare(`
        UPDATE claims
        SET status = 'processing'
        WHERE giveaway_id = ?
          AND user_id = ?
          AND status = 'pending'
      `).bind(
        giveawayId,
        user.id
      )

    ]);


  const giveawayUpdate =
    result[0];

  const claimUpdate =
    result[1];


  if (
    !giveawayUpdate.meta?.changes ||
    !claimUpdate.meta?.changes
  ) {

    await env.DB
      .prepare(`
        UPDATE giveaways
        SET status = 'full'
        WHERE id = ?
          AND status = 'active'
      `)
      .bind(
        giveawayId
      )
      .run();


    await disableGiveawayButton(
      giveaway,
      interaction,
      env
    );


    return messageResponse(
      "❌ Maaf, slot giveaway sudah diambil user lain.",
      [],
      true
    );
  }


  /*
  | If this was the last slot,
  | disable the public claim button.
  */

  if (
    Number(
      giveaway.winners
    ) <=
    Number(
      (
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
          .first()
      )?.count || 0
    )
  ) {

    const freshGiveaway =
      await getGiveaway(
        giveawayId,
        env
      );

    await disableGiveawayButton(
      freshGiveaway,
      interaction,
      env
    );
  }


  /*
  | Create private ticket.
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
      "Ticket creation failed:",
      error
    );


    /*
    | Roll back claim if ticket creation
    | fails so the slot isn't permanently lost.
    */

    await env.DB.batch([

      env.DB.prepare(`
        UPDATE claims
        SET status = 'pending'
        WHERE giveaway_id = ?
          AND user_id = ?
          AND status = 'processing'
      `).bind(
        giveawayId,
        user.id
      ),

      env.DB.prepare(`
        UPDATE giveaways
        SET status = 'active'
        WHERE id = ?
          AND status = 'full'
      `).bind(
        giveawayId
      )

    ]);


    return messageResponse(
      "❌ Claim diterima, tetapi ticket gagal dibuat. Silakan coba Confirm lagi.",
      [],
      true
    );
  }


  return messageResponse(

    [
      "✅ **Claim berhasil!**",
      "",
      `🎁 **Prize:** ${giveaway.prize}`,
      `👤 **Roblox:** ${claim.username}`,
      "",
      "⏳ **Processing**",
      "Ticket kamu sudah dibuat.",
      "",
      "Silakan tunggu proses hingga **24 jam**.",
      "",
      `🎫 Ticket: <#${ticket.id}>`
    ].join("\n"),

    [],

    true
  );
}


/*
|--------------------------------------------------------------------------
| CREATE PRIVATE TICKET
|--------------------------------------------------------------------------
*/

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
  | Prevent duplicate ticket.
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


  if (existing?.channel_id) {

    return {
      id:
        existing.channel_id
    };

  }


  const safeUsername =
    claim.username
      .toLowerCase()
      .replace(
        /[^a-z0-9-_]/g,
        "-"
      )
      .slice(0, 40);


  const channelName =
    `claim-${safeUsername}`;


  /*
  | Permission overwrites:
  |
  | @everyone → DENY VIEW_CHANNEL
  | claimer   → ALLOW VIEW/SEND/HISTORY
  | staff     → ALLOW VIEW/SEND/HISTORY
  | bot       → ALLOW VIEW/SEND/HISTORY
  */

  const overwrites = [

    {
      id:
        guildId,

      type: 0,

      allow: "0",

      deny:
        PERM_VIEW.toString()
    },

    {
      id:
        userId,

      type: 1,

      allow:
        PERM_TICKET.toString(),

      deny: "0"
    },

    {
      id:
        env.DISCORD_STAFF_ROLE_ID,

      type: 0,

      allow:
        PERM_TICKET.toString(),

      deny: "0"
    },

    {
      id:
        env.DISCORD_APPLICATION_ID,

      type: 1,

      allow:
        PERM_TICKET.toString(),

      deny: "0"
    }

  ];


  /*
  | Discord requires the bot to have
  | MANAGE_CHANNELS to create this channel.
  */

  const channel =
    await discordJSON(
      `/guilds/${guildId}/channels`,

      env,

      {
        method: "POST",

        body:
          JSON.stringify({

            name:
              channelName,

            type: 0,

            parent_id:
              env.DISCORD_TICKET_CATEGORY_ID,

            permission_overwrites:
              overwrites

          })
      }
    );


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
  | Send ticket message.
  */

  await discordJSON(
    `/channels/${channel.id}/messages`,

    env,

    {
      method: "POST",

      body:
        JSON.stringify({

          content:
            [
              `🎫 **Giveaway Claim Ticket**`,
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


  return channel;
}


/*
|--------------------------------------------------------------------------
| EDIT CLAIM
|--------------------------------------------------------------------------
*/

async function editClaim(
  interaction,
  giveawayId,
  env
) {
  const user =
    getUser(interaction);

  if (!user?.id) {
    return messageResponse(
      "❌ User tidak ditemukan.",
      [],
      true
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


/*
|--------------------------------------------------------------------------
| TICKET CLOSE
|--------------------------------------------------------------------------
*/

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

  const isStaff =
    Array.isArray(
      interaction.member?.roles
    ) &&
    interaction.member.roles.includes(
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


  await discordJSON(
    `/channels/${channelId}`,

    env,

    {
      method: "PATCH",

      body:
        JSON.stringify({
          name:
            `closed-${channelId.slice(-6)}`
        })
    }
  );


  return messageResponse(
    "🔒 Ticket ditutup. Channel akan dihapus dalam beberapa detik."
  );
}


/*
|--------------------------------------------------------------------------
| GIVEAWAY END
|--------------------------------------------------------------------------
*/

async function endGiveaway(
  interaction,
  env
) {
  const channelId =
    interaction.channel_id;


  const user =
    getUser(interaction);


  const isStaff =
    Array.isArray(
      interaction.member?.roles
    ) &&
    interaction.member.roles.includes(
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
        channelId
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


  await disableGiveawayButton(
    giveaway,
    interaction,
    env
  );


  return messageResponse(
    `🔒 Giveaway \`${giveaway.id}\` telah diakhiri oleh Staff.`
  );
}


/*
|--------------------------------------------------------------------------
| REGISTER COMMANDS
|--------------------------------------------------------------------------
*/

async function registerCommands(
  env
) {
  if (
    !env.DISCORD_TOKEN ||
    !env.DISCORD_APPLICATION_ID ||
    !env.DISCORD_GUILD_ID
  ) {
    throw new Error(
      "Discord configuration is incomplete."
    );
  }


  const url =
    `/applications/` +
    `${env.DISCORD_APPLICATION_ID}` +
    `/guilds/` +
    `${env.DISCORD_GUILD_ID}` +
    `/commands`;


  return discordJSON(
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
}


/*
|--------------------------------------------------------------------------
| MAIN WORKER
|--------------------------------------------------------------------------
*/

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


    /*
    |--------------------------------------------------------------------------
    | HOME
    |--------------------------------------------------------------------------
    */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        status:
          "online",

        database:
          Boolean(env.DB),

        bot:
          Boolean(env.DISCORD_TOKEN)
      });
    }


    /*
    |--------------------------------------------------------------------------
    | DEBUG
    |--------------------------------------------------------------------------
    */

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


    /*
    |--------------------------------------------------------------------------
    | REGISTER
    |--------------------------------------------------------------------------
    */

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
          success:
            true,

          message:
            "Discord slash commands registered.",

          commands
        });

      } catch (error) {

        return json(
          {
            success:
              false,

            error:
              error.message
          },

          500
        );

      }
    }


    /*
    |--------------------------------------------------------------------------
    | DISCORD INTERACTIONS
    |--------------------------------------------------------------------------
    */

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


      /*
      |--------------------------------------------------------------------------
      | PING
      |--------------------------------------------------------------------------
      */

      if (
        interaction.type === 1
      ) {
        return json({
          type: 1
        });
      }


      /*
      |--------------------------------------------------------------------------
      | SLASH COMMAND
      |--------------------------------------------------------------------------
      */

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
            env,
            ctx
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
          "❌ Unknown command.",
          [],
          true
        );
      }


      /*
      |--------------------------------------------------------------------------
      | BUTTON
      |--------------------------------------------------------------------------
      */

      if (
        interaction.type === 3
      ) {

        const customId =
          interaction.data?.custom_id ||
          "";


        /*
        | Claim
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
        | Confirm
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

          return confirmClaim(
            interaction,
            giveawayId,
            env
          );
        }


        /*
        | Edit
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
        | Ticket close button
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
          "❌ Unknown button.",
          [],
          true
        );
      }


      /*
      |--------------------------------------------------------------------------
      | MODAL SUBMIT
      |--------------------------------------------------------------------------
      */

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
          "❌ Unknown form.",
          [],
          true
        );
      }


      return messageResponse(
        "❌ Unsupported interaction.",
        [],
        true
      );
    }


    /*
    |--------------------------------------------------------------------------
    | 404
    |--------------------------------------------------------------------------
    */

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};
