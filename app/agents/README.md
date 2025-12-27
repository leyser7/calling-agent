# Agents Configuration

This directory contains agent configuration files in TOML format. Each agent represents a different conversational persona or assistant.

## Agent File Format

Each agent is defined in a `.toml` file with the following structure:

```toml
name = "Agent Name"
language = "en"  # or "es"

systemPrompt = """
Your agent's system prompt goes here.
You can use multiple lines.
"""
```

### Required Fields

- **name**: Display name of the agent (shown in the UI)
- **language**: Language code - `"en"` for English or `"es"` for Spanish
- **systemPrompt**: The system prompt that defines the agent's behavior

⚠️ **Warning**: If any required field is missing, the agent will still load but a warning will be displayed. Default values will be used where possible.

## Available Agents

The following agents are currently configured:

- **default.toml** - Default friendly assistant (English)
- **santa_claus_adult.toml** - Santa Claus for adults (Spanish)
- **asistente_ventas.toml** - Sales assistant (Spanish)
- **hotel_cancel.toml** - Hotel cancellation agent (English)

## Using an Agent

To use a specific agent, add the `prompt` query parameter to the URL:

```
http://localhost:3000/?prompt=santa_claus_adult
http://localhost:3000/?prompt=default
http://localhost:3000/?prompt=asistente_ventas
```

The agent ID is the filename without the `.toml` extension.

## Creating a New Agent

1. Create a new `.toml` file in this directory
2. Add the required fields: `name`, `language`, and `systemPrompt`
3. Restart the server to load the new agent
4. Access it via `?prompt=your_agent_filename`

### Example: Creating a tech support agent

Create `agents/tech_support.toml`:

```toml
name = "Tech Support"
language = "en"

systemPrompt = """
You are a helpful tech support agent. You assist users with technical issues in a friendly and patient manner.

- Keep responses concise (1-3 sentences)
- Ask clarifying questions when needed
- Provide step-by-step guidance
- Be empathetic and understanding
"""
```

Then access it at: `http://localhost:3000/?prompt=tech_support`

## Language Support

The agent's `language` field automatically changes the UI language:

- `language = "es"` → Spanish UI (Iniciar, Finalizar, etc.)
- `language = "en"` → English UI (Start, End, etc.)

## Notes

- Agent files are loaded at server startup
- Changes require a server restart to take effect
- The system prompt supports markdown formatting
- Use triple quotes `"""` for multiline prompts
