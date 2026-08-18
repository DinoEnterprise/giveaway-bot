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
    description: "End a giveaway"
  },
  {
    name: "ticket-close",
    description: "Close a ticket"
  }
];

function response(data) {
  return new Response(
    JSON.stringify(data),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function interactionResponse(content) {
  return response({
    type: 4,
    data: {
      content
    }
  });
}

async function verify(request, env) {
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

    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(
        timestamp + body
      )
    );
  } catch (error) {
    console.error(error);
    return false;
  }
}

function hexToBytes(hex) {
  const result =
    new Uint8Array(
      hex.length / 2
    );

  for (
    let i = 0;
    i < hex.length;
    i += 2
  ) {
    result[i / 2] =
      parseInt(
        hex.substring(
          i,
          i + 2
        ),
        16
      );
  }

  return result;
}

async function registerCommands(env) {
  const url =
    `${DISCORD_API}/applications/` +
    `${env.DISCORD_APPLICATION_ID}/guilds/` +
    `${env.DISCORD_GUILD_ID}/commands`;

  const result =
    await fetch(url, {
      method: "PUT",
      headers: {
        Authorization:
          `Bot ${env.DISCORD_TOKEN}`,
        "Content-Type":
          "application/json"
      },
      body:
        JSON.stringify(
          COMMANDS
        )
    });

  return result.json();
}

export default {
  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );

    /* HOME */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return response({
        status: "online",
        database:
          Boolean(env.DB)
      });
    }

    /* DEBUG */

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

    /* REGISTER COMMANDS */

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

    /* DISCORD */

    if (
      request.method === "POST" &&
      url.pathname === "/interactions"
    ) {
      const valid =
        await verify(
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

      /* DISCORD PING */

      if (
        interaction.type === 1
      ) {
        return response({
          type: 1
        });
      }

      /* SLASH COMMAND */

      if (
        interaction.type === 2
      ) {
        const command =
          interaction.data?.name;

        console.log(
          "Command:",
          command
        );

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

          return interactionResponse(
            [
              "🎁 **ROBUX GIVEAWAY**",
              "",
              `**Prize:** ${prize}`,
              `**Winners:** ${winners}`,
              "",
              "Klik tombol di bawah untuk claim.",
              "",
              "🛠️ Giveaway system is online."
            ].join("\n")
          );
        }

        if (
          command ===
          "giveaway-end"
        ) {
          return interactionResponse(
            "🔒 Giveaway ended."
          );
        }

        if (
          command ===
          "ticket-close"
        ) {
          return interactionResponse(
            "🔒 Ticket closed."
          );
        }

        return interactionResponse(
          "❌ Unknown command."
        );
      }

      return interactionResponse(
        "❌ Unsupported interaction."
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
