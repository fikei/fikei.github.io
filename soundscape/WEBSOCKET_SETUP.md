# WebSocket Server Setup Guide

This guide explains how to set up and deploy the WebSocket server for the Soundscape mobile companion feature.

## Overview

The mobile companion feature uses WebSocket for real-time bidirectional communication between the desktop visualization and mobile control interface. This allows you to control the visualization from any device on the same network or over the internet.

## Local Development Setup

### Prerequisites

- Node.js 16 or higher
- npm (comes with Node.js)

### Installation

1. Navigate to the soundscape directory:
```bash
cd soundscape
```

2. Install dependencies:
```bash
npm install
```

3. Start the WebSocket server:
```bash
npm start
```

The server will start on port 3000 by default. You should see:
```
🚀 Soundscape WebSocket server running on port 3000
📱 Access at: http://localhost:3000/
```

4. Open the desktop app:
```
http://localhost:3000/index.html
```

5. Click the 📱 button to see your 6-digit pairing code

6. On your mobile device (connected to the same network), open:
```
http://YOUR_LOCAL_IP:3000/mobile.html
```

To find your local IP:
- **Mac**: `ifconfig | grep "inet " | grep -v 127.0.0.1`
- **Linux**: `hostname -I`
- **Windows**: `ipconfig`

### Development Mode

For auto-restart on file changes, use nodemon:
```bash
npm run dev
```

## Deployment Options

### Option 1: Render (Recommended - Free)

[Render](https://render.com) offers free hosting for web services with automatic HTTPS.

1. Create a Render account at https://render.com

2. Click "New +" → "Web Service"

3. Connect your GitHub repository

4. Configure the service:
   - **Name**: soundscape-websocket
   - **Region**: Choose closest to you
   - **Branch**: main (or your branch name)
   - **Root Directory**: soundscape
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free

5. Add environment variable (optional):
   - **Key**: PORT
   - **Value**: 10000 (or leave empty, Render sets this automatically)

6. Click "Create Web Service"

7. Wait for deployment (first deploy takes ~5 minutes)

8. Your WebSocket server will be available at:
```
https://soundscape-websocket.onrender.com
```

9. Update your GitHub Pages deployment to use this URL by modifying the socketUrl in both index.html and mobile.html (see "Production Configuration" below)

**Note**: Free Render instances spin down after 15 minutes of inactivity. First connection may take 30-60 seconds to wake up.

### Option 2: Railway

[Railway](https://railway.app) offers $5 free credit per month.

1. Create a Railway account at https://railway.app

2. Click "New Project" → "Deploy from GitHub repo"

3. Select your repository

4. Railway auto-detects Node.js and uses package.json scripts

5. Click "Add variables" and set:
   - **PORT**: (Railway provides this automatically)

6. Your service will be available at a Railway-provided URL

7. Go to Settings → Generate Domain to get a public URL

### Option 3: Heroku

[Heroku](https://heroku.com) offers free dyno hours (requires credit card verification).

1. Install Heroku CLI:
```bash
brew install heroku/brew/heroku  # Mac
# or download from https://devcenter.heroku.com/articles/heroku-cli
```

2. Login and create app:
```bash
cd soundscape
heroku login
heroku create soundscape-websocket
```

3. Deploy:
```bash
git init  # if not already a git repo
git add .
git commit -m "Add WebSocket server"
heroku git:remote -a soundscape-websocket
git push heroku main
```

4. Your server will be at:
```
https://soundscape-websocket.herokuapp.com
```

### Option 4: DigitalOcean App Platform

[DigitalOcean](https://www.digitalocean.com/products/app-platform) offers $5/month basic tier.

1. Create DigitalOcean account

2. Go to App Platform → Create App

3. Connect GitHub repository

4. Configure:
   - **Source Directory**: soundscape
   - **Autodeploy**: Yes
   - **Type**: Web Service
   - **Build Command**: `npm install`
   - **Run Command**: `npm start`

5. Choose $5/month Basic plan

6. Launch app

### Option 5: Self-Hosted VPS

For full control, deploy to your own VPS (AWS, DigitalOcean, Linode, etc.).

1. SSH into your server

2. Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. Clone repository and install:
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO/soundscape
npm install
```

4. Use PM2 to keep server running:
```bash
sudo npm install -g pm2
pm2 start server.js --name soundscape
pm2 startup
pm2 save
```

5. Configure nginx reverse proxy:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

6. Enable HTTPS with Let's Encrypt:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Production Configuration

After deploying your WebSocket server, update the connection URLs in your code:

### For GitHub Pages Deployment

If your static files are on GitHub Pages but WebSocket server is elsewhere:

1. Find this code in `index.html` (around line 4620):
```javascript
const socketUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://localhost:3000`
    : `${window.location.protocol}//${window.location.host}`;
```

2. Replace with:
```javascript
const socketUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://localhost:3000`
    : `https://YOUR_WEBSOCKET_SERVER_URL`;  // e.g., https://soundscape-websocket.onrender.com
```

3. Make the same change in `mobile.html` (around line 350)

### For All-in-One Deployment

If you deploy both static files and WebSocket server together (e.g., on Render), the default configuration will work automatically.

## Environment Variables

You can configure the server with these environment variables:

- **PORT**: Server port (default: 3000)

Set in your deployment platform or locally:
```bash
PORT=8080 npm start
```

## Security Considerations

1. **HTTPS Required**: For production, always use HTTPS to encrypt WebSocket traffic

2. **CORS**: The server allows all origins (`*`) for development. For production, restrict to your domains:

Edit `server.js`:
```javascript
const io = new Server(server, {
    cors: {
        origin: ["https://ianfike.com", "https://yourdomain.com"],
        methods: ["GET", "POST"]
    }
});
```

3. **Rate Limiting**: Consider adding rate limiting for production:
```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);
```

## Monitoring

View server logs:
- **Render**: Dashboard → Logs tab
- **Railway**: Project → Deployments → View Logs
- **Heroku**: `heroku logs --tail`
- **PM2**: `pm2 logs soundscape`

## Troubleshooting

### "Connection failed" on mobile

1. Check server is running:
```bash
curl http://localhost:3000
```

2. Check firewall allows port 3000

3. Verify mobile device is on same network as server

4. Check console logs in browser DevTools

### Pairing code not showing

1. Open browser DevTools console
2. Look for "Pairing code generated" message
3. If missing, check WebSocket connection status

### Mobile controls don't update desktop

1. Check console logs on both desktop and mobile
2. Verify WebSocket events are being sent/received
3. Ensure both are connected to the same session code

### Server keeps spinning down (Render free tier)

This is normal behavior for free Render instances. Consider:
- Upgrading to paid tier ($7/month)
- Using a different platform
- Implementing a keep-alive ping from your domain

## Testing

Test the WebSocket connection:

1. Open desktop app
2. Open DevTools console
3. Look for:
```
🔌 Connected to WebSocket server
📱 Pairing code generated: 123456
```

4. Open mobile app
5. Enter pairing code
6. Look for:
```
🔌 Connected to WebSocket server
📱 Mobile device connected
```

7. Move a slider on mobile
8. Verify desktop UI updates

## Cost Summary

| Platform | Cost | Notes |
|----------|------|-------|
| Render | Free | Spins down after inactivity |
| Railway | Free $5/month credit | ~750 hours/month |
| Heroku | Free | Requires credit card |
| DigitalOcean | $5/month | Always on |
| Self-hosted VPS | $5-10/month | Full control |

## Next Steps

1. Choose a deployment platform
2. Deploy the WebSocket server
3. Update production URLs in code
4. Test pairing on different devices
5. Set up custom domain (optional)
6. Configure CORS for production
7. Add monitoring/logging

## Support

If you encounter issues:
1. Check server logs
2. Check browser console
3. Verify network connectivity
4. Review firewall settings
