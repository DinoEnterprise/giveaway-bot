const DISCORD_API = "https://discord.com/api/v10";

/*
|--------------------------------------------------------------------------
| RESPONSE HELPERS
|--------------------------------------------------------------------------
*/

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

function discordResponse(data) {
  return new Response(
    JSON.stringify(data),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}


/*
|--------------------------------------------------------------------------
| DISCORD REQUEST
|--------------------------------------------------------------------------
*/

async function discordRequest(
  env,
  endpoint,
  options = {}
) {
  return fetch(
    `${DISCORD_API}${endpoint}`,
    {
      ...options,

      headers: {
        "Authorization":
          `Bot ${env.DISCORD_TOKEN}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {})
      }
    }
  );
}


/*
|--------------------------------------------------------------------------
| VERIFY DISCORD SIGNATURE
|--------------------------------------------------------------------------
|
| Discord Interaction Endpoint membutuhkan
| Ed25519 signature verification.
|
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
    !timestamp
  ) {
    return false;
  }

  const body =
    await request.clone().arrayBuffer();

  const publicKey =
    await crypto.subtle.importKey(
      "raw",
      hexToUint8Array(
        env.DISCORD_PUBLIC_KEY
      ),
      {
        name: "Ed25519"
      },
      false,
      [
        "verify"
      ]
    );

  const message =
    new TextEncoder().encode(
      timestamp +
      new TextDecoder().decode(body)
    );

  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    hexToUint8Array(signature),
    message
  );
}


function hexToUint8Array(hex) {

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
| DISCORD INTERACTION RESPONSE
|--------------------------------------------------------------------------
*/

function interactionMessage(
  content,
  ephemeral = false
) {
  return discordResponse({
    type: 4,

    data: {
      content,

      flags:
        ephemeral
          ? 64
          : 0
    }
  });
}


/*
|--------------------------------------------------------------------------
| GIVEAWAY EMBED
|--------------------------------------------------------------------------
*/

function giveawayEmbed(
  giveaway,
  claimed
) {

  let status =
    giveaway.status === "active"
      ? "🟢 OPEN"
      : giveaway.status === "full"
      ? "🔴 FULL"
      : "⚫ CLOSED";

  return {
    title: "🎁 Giveaway",

    description:
      `**Prize:** ${giveaway.prize}\n\n` +
      `**Winner Slots:** ` +
      `${claimed}/${giveaway.winners}\n\n` +
      `**Status:** ${status}\n\n` +
      `First come, first served.`,

    footer: {
      text:
        "Giveaway Bot"
    }
  };
}


/*
|--------------------------------------------------------------------------
| GIVEAWAY BUTTON
|--------------------------------------------------------------------------
*/

function giveawayButton(
  giveaway,
  claimed
) {

  const disabled =
    giveaway.status !== "active" ||
    claimed >= giveaway.winners;

  return [
    {
      type: 1,

      components: [

        {
          type: 2,

          custom_id:
            `giveaway_claim:${giveaway.id}`,

          label:
            disabled
              ? "Claim Closed"
              : "🎁 Claim",

          style: 1,

          disabled
        }

      ]
    }
  ];
}


/*
|--------------------------------------------------------------------------
| /giveaway
|--------------------------------------------------------------------------
*/

async function commandGiveaway(
  interaction,
  env
) {

  const options =
    interaction.data.options || [];

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
    !winners ||
    winners < 1
  ) {
    return interactionMessage(
      "❌ Prize dan jumlah winners wajib diisi.",
      true
    );
  }


  const id =
    `GW-${crypto.randomUUID()}`;

  const now =
    new Date().toISOString();


  await env.DB.prepare(`
    INSERT INTO giveaways
    (
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
      id,
      interaction.guild_id,
      interaction.channel_id,
      null,
      prize,
      winners,
      "active",
      interaction.member?.user?.id ||
        interaction.user?.id,
      now
    )
    .run();


  const embed =
    giveawayEmbed(
      {
        id,
        prize,
        winners,
        status: "active"
      },
      0
    );


  const components =
    giveawayButton(
      {
        id,
        winners,
        status: "active"
      },
      0
    );


  return discordResponse({

    type: 4,

    data: {

      embeds: [
        embed
      ],

      components

    }

  });

}


/*
|--------------------------------------------------------------------------
| CLAIM BUTTON
|--------------------------------------------------------------------------
*/

async function handleClaim(
  interaction,
  env
) {

  const giveawayId =
    interaction.data.custom_id
      .split(":")[1];


  const giveaway =
    await env.DB.prepare(`
      SELECT *
      FROM giveaways
      WHERE id = ?
    `)
      .bind(giveawayId)
      .first();


  if (!giveaway) {

    return interactionMessage(
      "❌ Giveaway tidak ditemukan.",
      true
    );

  }


  const result =
    await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM claims
      WHERE giveaway_id = ?
    `)
      .bind(giveawayId)
      .first();


  const claimed =
    Number(result.count);


  if (
    giveaway.status !== "active" ||
    claimed >= giveaway.winners
  ) {

    return interactionMessage(
      "❌ Maaf, semua slot giveaway sudah terisi atau giveaway sudah berakhir.",
      true
    );

  }


  const userId =
    interaction.member?.user?.id ||
    interaction.user?.id;


  /*
   * DUPLICATE CHECK
   */

  const existing =
    await env.DB.prepare(`
      SELECT id
      FROM claims
      WHERE giveaway_id = ?
      AND user_id = ?
    `)
      .bind(
        giveawayId,
        userId
      )
      .first();


  if (existing) {

    return interactionMessage(
      "❌ Kamu sudah melakukan claim pada giveaway ini.",
      true
    );

  }


  /*
   * OPEN MODAL
   */

  return discordResponse({

    type: 9,

    data: {

      custom_id:
        `roblox_claim:${giveawayId}`,

      title:
        "Roblox Giveaway Claim",

      components: [

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

              required: true,

              max_length: 32,

              placeholder:
                "Contoh: Builderman"

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

              required: true,

              max_length: 32,

              placeholder:
                "Contoh: builderman"

            }

          ]

        }

      ]

    }

  });

}


/*
|--------------------------------------------------------------------------
| ROBLOX FORM
|--------------------------------------------------------------------------
*/

async function handleRobloxForm(
  interaction,
  env
) {

  const giveawayId =
    interaction.data.custom_id
      .split(":")[1];


  const fields =
    interaction.data.components
      .flatMap(
        row => row.components
      );


  const displayName =
    fields.find(
      x =>
        x.custom_id ===
        "display_name"
    )?.value;


  const username =
    fields.find(
      x =>
        x.custom_id ===
        "username"
    )?.value;


  const userId =
    interaction.member?.user?.id ||
    interaction.user?.id;


  /*
   * Check giveaway
   */

  const giveaway =
    await env.DB.prepare(`
      SELECT *
      FROM giveaways
      WHERE id = ?
    `)
      .bind(giveawayId)
      .first();


  if (!giveaway) {

    return interactionMessage(
      "❌ Giveaway tidak ditemukan.",
      true
    );

  }


  /*
   * Check duplicate
   */

  const duplicate =
    await env.DB.prepare(`
      SELECT id
      FROM claims
      WHERE giveaway_id = ?
      AND user_id = ?
    `)
      .bind(
        giveawayId,
        userId
      )
      .first();


  if (duplicate) {

    return interactionMessage(
      "❌ Kamu sudah claim giveaway ini.",
      true
    );

  }


  /*
   * Preview
   */

  return discordResponse({

    type: 4,

    data: {

      flags: 64,

      embeds: [

        {

          title:
            "🔎 Confirm Claim",

          description:
            `**Prize:** ${giveaway.prize}\n\n` +
            `**Display Name:** ${displayName}\n` +
            `**Username:** ${username}\n\n` +
            `Pastikan data kamu benar.`

        }

      ],

      components: [

        {

          type: 1,

          components: [

            {

              type: 2,

              custom_id:
                `confirm:${giveawayId}:${encodeURIComponent(displayName)}:${encodeURIComponent(username)}`,

              label:
                "Confirm",

              style: 3

            },

            {

              type: 2,

              custom_id:
                `edit:${giveawayId}`,

              label:
                "Edit",

              style: 2

            }

          ]

        }

      ]

    }

  });

}


/*
|--------------------------------------------------------------------------
| CONFIRM CLAIM
|--------------------------------------------------------------------------
*/

async function confirmClaim(
  interaction,
  env
) {

  const parts =
    interaction.data.custom_id
      .split(":");


  const giveawayId =
    parts[1];


  const displayName =
    decodeURIComponent(
      parts[2]
    );


  const username =
    decodeURIComponent(
      parts.slice(3).join(":")
    );


  const userId =
    interaction.member?.user?.id ||
    interaction.user?.id;


  /*
   * TRANSACTION-LIKE SLOT CHECK
   */

  const giveaway =
    await env.DB.prepare(`
      SELECT *
      FROM giveaways
      WHERE id = ?
    `)
      .bind(giveawayId)
      .first();


  if (!giveaway) {

    return interactionMessage(
      "❌ Giveaway tidak ditemukan.",
      true
    );

  }


  const count =
    await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM claims
      WHERE giveaway_id = ?
    `)
      .bind(giveawayId)
      .first();


  if (
    giveaway.status !== "active" ||
    Number(count.count) >= giveaway.winners
  ) {

    return interactionMessage(
      "❌ Kamu terlambat. Semua slot sudah terisi.",
      true
    );

  }


  /*
   * DUPLICATE
   */

  const duplicate =
    await env.DB.prepare(`
      SELECT id
      FROM claims
      WHERE giveaway_id = ?
      AND user_id = ?
    `)
      .bind(
        giveawayId,
        userId
      )
      .first();


  if (duplicate) {

    return interactionMessage(
      "❌ Kamu sudah claim giveaway ini.",
      true
    );

  }


  const claimId =
    `CL-${crypto.randomUUID()}`;

  const ticketId =
    `TK-${crypto.randomUUID()}`;

  const now =
    new Date().toISOString();


  /*
   * INSERT CLAIM
   */

  await env.DB.prepare(`
    INSERT INTO claims
    (
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
      claimId,
      giveawayId,
      userId,
      username,
      displayName,
      "processing",
      now
    )
    .run();


  /*
   * CHECK IF FULL
   */

  const newCount =
    await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM claims
      WHERE giveaway_id = ?
    `)
      .bind(giveawayId)
      .first();


  if (
    Number(newCount.count) >=
    giveaway.winners
  ) {

    await env.DB.prepare(`
      UPDATE giveaways
      SET status = 'full'
      WHERE id = ?
    `)
      .bind(giveawayId)
      .run();

  }


  /*
   * SAVE TICKET
   *
   * Discord channel creation will be
   * added in the next layer.
   */

  await env.DB.prepare(`
    INSERT INTO tickets
    (
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
      giveawayId,
      claimId,
      userId,
      null,
      "open",
      now
    )
    .run();


  /*
   * SUCCESS
   */

  return interactionMessage(

    `✅ **Claim berhasil!**\n\n` +

    `Prize: **${giveaway.prize}**\n` +

    `Roblox Display Name: **${displayName}**\n` +

    `Roblox Username: **${username}**\n\n` +

    `Status: **Processing**\n\n` +

    `Silakan tunggu hingga **24 jam** untuk proses selanjutnya.`,

    true

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
    env
  ) {

    const url =
      new URL(request.url);


    /*
     * HEALTH CHECK
     */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {

      return new Response(
        "Giveaway Bot Worker is online."
      );

    }


    /*
     * DISCORD
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
          "Invalid request signature.",
          {
            status: 401
          }
        );

      }


      const interaction =
        await request.json();


      /*
       * PING
       */

      if (
        interaction.type === 1
      ) {

        return discordResponse({
          type: 1
        });

      }


      /*
       * SLASH COMMAND
       */

      if (
        interaction.type === 2
      ) {

        const command =
          interaction.data.name;


        if (
          command === "giveaway"
        ) {

          return commandGiveaway(
            interaction,
            env
          );

        }


        if (
          command === "giveaway-end"
        ) {

          return interactionMessage(
            "🔒 Giveaway-end handler siap digunakan.",
            true
          );

        }


        if (
          command === "ticket-close"
        ) {

          return interactionMessage(
            "🔒 Ticket-close handler siap digunakan.",
            true
          );

        }

      }


      /*
       * BUTTON
       */

      if (
        interaction.type === 3
      ) {

        const customId =
          interaction.data.custom_id;


        if (
          customId.startsWith(
            "giveaway_claim:"
          )
        ) {

          return handleClaim(
            interaction,
            env
          );

        }


        if (
          customId.startsWith(
            "confirm:"
          )
        ) {

          return confirmClaim(
            interaction,
            env
          );

        }

      }


      /*
       * MODAL
       */

      if (
        interaction.type === 5
      ) {

        const customId =
          interaction.data.custom_id;


        if (
          customId.startsWith(
            "roblox_claim:"
          )
        ) {

          return handleRobloxForm(
            interaction,
            env
          );

        }

      }


      return interactionMessage(
        "Unknown interaction.",
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
