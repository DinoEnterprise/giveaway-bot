const DISCORD_API = "https://discord.com/api/v10";

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
    description: "End the current giveaway"
  },

  {
    name: "ticket-close",
    description: "Close a giveaway ticket"
  }
];


/*
|--------------------------------------------------------------------------
| RESPONSE
|--------------------------------------------------------------------------
*/

function response(data, status = 200) {
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


/*
|--------------------------------------------------------------------------
| HEX → BYTES
|--------------------------------------------------------------------------
*/

function hexToBytes(hex) {
  const bytes =
    new Uint8Array(hex.length / 2);

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
| DISCORD SIGNATURE VERIFICATION
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

      hexToBytes(
        signature
      ),

      message
    );

  } catch (error) {
    console.error(
      "Signature verification error:",
      error
    );

    return false;
  }
}


/*
|--------------------------------------------------------------------------
| DISCORD INTERACTION MESSAGE
|--------------------------------------------------------------------------
*/

function interactionMessage(
  content,
  ephemeral = false
) {
  return response({
    type: 4,

    data: {
      content,

      ...(ephemeral
        ? {
            flags: 64
          }
        : {})
    }
  });
}


/*
|--------------------------------------------------------------------------
| REGISTER SLASH COMMANDS
|--------------------------------------------------------------------------
*/

async function registerCommands(env) {

  if (
    !env.DISCORD_TOKEN
  ) {
    throw new Error(
      "DISCORD_TOKEN is missing"
    );
  }

  if (
    !env.DISCORD_APPLICATION_ID
  ) {
    throw new Error(
      "DISCORD_APPLICATION_ID is missing"
    );
  }

  if (
    !env.DISCORD_GUILD_ID
  ) {
    throw new Error(
      "DISCORD_GUILD_ID is missing"
    );
  }


  const url =
    `${DISCORD_API}/applications/` +
    `${env.DISCORD_APPLICATION_ID}` +
    `/guilds/` +
    `${env.DISCORD_GUILD_ID}` +
    `/commands`;


  const result =
    await fetch(
      url,
      {
        method: "PUT",

        headers: {
          "Authorization":
            `Bot ${env.DISCORD_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            COMMANDS
          )
      }
    );


  const text =
    await result.text();


  if (!result.ok) {

    throw new Error(
      `Discord API ${result.status}: ${text}`
    );

  }


  return JSON.parse(text);
}


/*
|--------------------------------------------------------------------------
| CREATE GIVEAWAY
|--------------------------------------------------------------------------
*/

async function createGiveaway(
  interaction,
  env
) {

  const options =
    interaction.data?.options ||
    [];


  const prize =
    options.find(
      option =>
        option.name ===
        "prize"
    )?.value;


  const winners =
    options.find(
      option =>
        option.name ===
        "winners"
    )?.value;


  if (
    !prize ||
    !winners
  ) {

    return interactionMessage(
      "❌ Prize dan jumlah winners wajib diisi.",
      true
    );

  }


  const giveawayId =
    `GW-${crypto.randomUUID()}`;


  const createdAt =
    new Date().toISOString();


  const creator =
    interaction.member?.user?.id ||
    interaction.user?.id;


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

      creator,

      createdAt
    )

    .run();


  return interactionMessage(
    `🎁 **Giveaway dibuat!**\n\n` +

    `**Prize:** ${prize}\n` +

    `**Winners:** ${winners}\n` +

    `**ID:** \`${giveawayId}\`\n\n` +

    `Sistem claim akan segera tersedia.`
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

      return response({
        status: "online",

        message:
          "Giveaway Bot Worker is online!"
      });

    }


    /*
    |--------------------------------------------------------------------------
    | DEBUG
    |--------------------------------------------------------------------------
    |
    | Hanya menunjukkan apakah variable tersedia.
    | TIDAK menampilkan token atau ID.
    |
    */

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
          Boolean(
            env.DB
          )

      });

    }


    /*
    |--------------------------------------------------------------------------
    | REGISTER COMMANDS
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


        return response({

          success: true,

          message:
            "Discord slash commands registered.",

          commands

        });


      } catch (error) {

        return response(

          {
            success: false,

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

        return response({
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


        /*
        | /giveaway
        */

        if (
          command ===
          "giveaway"
        ) {

          return createGiveaway(
            interaction,
            env
          );

        }


        /*
        | /giveaway-end
        */

        if (
          command ===
          "giveaway-end"
        ) {

          return interactionMessage(
            "🔒 Giveaway-end belum diaktifkan.",
            true
          );

        }


        /*
        | /ticket-close
        */

        if (
          command ===
          "ticket-close"
        ) {

          return interactionMessage(
            "🔒 Ticket-close belum diaktifkan.",
            true
          );

        }

      }


      return interactionMessage(
        "Unknown interaction.",
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
