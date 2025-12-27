# Voice AI Calling Agent

Real-time conversational agent application with natural voice interactions powered by WebSocket streaming.

## Prerequisites

- Node.js v14+
- AWS account with Amazon Bedrock access
- Modern browser with microphone support

## Quick Start

```bash
# Install dependencies
cd app
npm install

# Configure AWS credentials
export AWS_PROFILE=your-profile-name

# Build
npm run build

# Start server
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Using Different Agents

Access different conversational agents via URL parameter:

```
http://localhost:3000/?prompt=santa_claus_adult
http://localhost:3000/?prompt=asistente_ventas
http://localhost:3000/?prompt=hotel_cancel
```

Available agents are in [app/agents/](app/agents/)

## License

See [LICENSE](LICENSE)
