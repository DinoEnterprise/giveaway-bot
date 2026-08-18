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

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  return bytes;
}

async function verifyDiscordRequest(request, env) {
  const signature =
    request.headers.get("X-Signature-Ed25519");

  const timestamp =
    request.headers.get("X-Signature-Timestamp");

  if (!signature || !timestamp) {
    return false;
  }

  const body = await request.clone().text();

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

  const message = new TextEncoder().encode(
    timestamp + body
  );

  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    hexToBytes(signature),
    message
  );
}

function response(data) {
  return new Response(
    JSON.stringify(data),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function interactionResponse(
  content,
  ephemeral = false
) {
  return response({
    type: 4,
    data: {
      content,
      ...(ephemeral ? { flags: 64 } : {})
    }
  });
}

async function registerCommands(env) {
  const url =
    `${DISCORD_API}/applications/` +
    `${env.DISCORD_APPLICATION_ID}/guilds/` +
    `${env.DISCORD_GUILD_ID}/commands`;

  const result = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization":
        `Bot ${env.DISCORD_TOKEN}`,
      "Content-Type":
        "application/json"
    },
    body: JSON.stringify(COMMANDS)
  });

  if (!result.ok) {
    const text = await result.text();

    throw new Error(
      `Command registration failed: ${text}`
    );
  }

  return result.json();
}

async function createGiveaway(
  interaction,
  env
) {
  const options =
    interaction.data.options || [];

  const prize =
    options.find(
      option => option.name === "prize"
    )?.value;

  const winners =
    options.find(
      option => option.name === "winners"
    )?.value;

  if (!prize || !winners) {
    return interactionResponse(
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

  await env.DB.prepare(`
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
      prize,
      Number(winners),
      "active",
      creator,
      createdAt
    )
    .run();

  return interactionResponse(
    `🎁 **Giveaway dibuat!**\n\n` +
    `**Prize:** ${prize}\n` +
    `**Winners:** ${winners}\n` +
    `**ID:** \`${giveawayId}\`\n\n` +
    `🔘 Sistem Claim akan segera digunakan.`
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return response({
        status: "online",
        database: "connected"
      });
    }

    // Register commands manually
    if (
      request.method === "GET" &&
      url.pathname === "/register"
    ) {
      try {
        const commands =
          await registerCommands(env);

        return response({
          success: true,
          commands
        });

      } catch (error) {
        return response(
          {
            success: false,
            error: error.message
          },
          500
        );
      }
    }

    // Discord interactions
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
          { status: 401 }
        );
      }

      const interaction =
        await request.json();

      // Discord PING
      if (interaction.type === 1) {
        return response({
          type: 1
        });
      }

      // Slash command
      if (interaction.type === 2) {
        const command =
          interaction.data.name;

        if (command === "giveaway") {
          return createGiveaway(
            interaction,
            env
          );
        }

        if (command === "giveaway-end") {
          return interactionResponse(
            "🔒 Giveaway-end akan kita aktifkan pada tahap berikutnya.",
            true
          );
        }

        if (command === "ticket-close") {
          return interactionResponse(
            "🔒 Ticket-close akan kita aktifkan pada tahap berikutnya.",
            true
          );
        }
      }

      return interactionResponse(
        "Unknown interaction.",
        true
      );
    }

    return new Response(
      "Not Found",
      { status: 404 }
    );
  }
};
