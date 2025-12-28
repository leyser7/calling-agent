# AWS EC2 Deployment Guide

Complete step-by-step guide to deploy the Voice AI Calling Agent application on AWS EC2 using CloudFormation.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment Steps](#deployment-steps)
  - [Step 1: Deploy CloudFormation Stack](#step-1-deploy-cloudformation-stack)
  - [Step 2: Build Application Locally](#step-2-build-application-locally)
  - [Step 3: Package for Deployment](#step-3-package-for-deployment)
  - [Step 4: Upload to EC2](#step-4-upload-to-ec2)
  - [Step 5: Configure Application on EC2](#step-5-configure-application-on-ec2)
  - [Step 6: Start with PM2](#step-6-start-with-pm2)
  - [Step 7: Access Your Application](#step-7-access-your-application)
- [Updating the Application](#updating-the-application)
- [Useful PM2 Commands](#useful-pm2-commands)
- [Troubleshooting](#troubleshooting)
- [Clean Up Resources](#clean-up-resources)

## Prerequisites

- AWS Account with Bedrock access
- AWS CLI configured with appropriate credentials
- Node.js v14+ installed locally
- EC2 Key Pair for SSH access

## Deployment Steps

### Step 1: Deploy CloudFormation Stack

Deploy the infrastructure stack from infra.yml

### Step 2: Build Application Locally

From the project root directory:

```bash
# Navigate to application directory
cd app

# Install dependencies
npm install

# Build the application
npm run build
```

This will generate compiled files in the `dist/` directory.

### Step 3: Package for Deployment

Create a deployment package with all necessary files:

```bash
# From the app/ directory
# Create a tar archive with the application
tar -czf voice-ai-app.tar.gz \
  dist \
  public \
  agents \
  package.json
```

### Step 4: Upload to EC2

```bash
# Upload the package
scp -i your-key-pair.pem voice-ai-app.tar.gz ec2-user@${EC2_IP}:/tmp/

# Connect to the instance
ssh -i your-key-pair.pem ec2-user@${EC2_IP}
```

### Step 5: Configure Application on EC2

Once connected to the EC2 instance:

```bash
# Extract the application
cd /opt/app
sudo tar -xzf /tmp/voice-ai-app.tar.gz
sudo chown -R ec2-user:ec2-user /opt/app

# Install production dependencies
npm install --omit=dev

# Verify files are in place
ls -la /opt/app/
# You should see: dist/, public/, agents/, package.json
```

### Step 6: Start with PM2

```bash
# Start the application
pm2 start dist/server.js --name voice-ai-agent

# Save PM2 configuration
pm2 save

# Verify it's running
pm2 status

# View logs in real-time
pm2 logs voice-ai-agent
```

### Step 7: Access Your Application

Open the URL in your browser:
- Main URL: `https://xxxxx.cloudfront.net`
- Santa Claus Agent: `https://xxxxx.cloudfront.net/?prompt=santa_claus_adult`
- Sales Agent: `https://xxxxx.cloudfront.net/?prompt=asistente_ventas`
- Hotel Agent: `https://xxxxx.cloudfront.net/?prompt=hotel_cancel`

## Updating the Application

For future updates:

```bash
# 1. Build locally
cd app
npm run build

# 2. Create new package
tar -czf voice-ai-app.tar.gz dist public agents package.json

# 3. Upload to EC2
scp -i your-key-pair.pem voice-ai-app.tar.gz ec2-user@${EC2_IP}:/tmp/

# 4. On EC2 instance
cd /opt/app
sudo tar -xzf /tmp/voice-ai-app.tar.gz --strip-components=1
pm2 restart voice-ai-agent
```