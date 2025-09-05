# Deployment Instructions

## Option 1: Deploy to Render.com (Recommended - Free)

1. **Push code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Create Render account** at https://render.com

3. **Create new Web Service**
   - Connect your GitHub account
   - Select your repository
   - Configure:
     - **Name**: maze-bingo-auction
     - **Environment**: Node
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`
     - **Instance Type**: Free

4. **Add Environment Variables** in Render dashboard:
   - `NODE_ENV`: production
   - `CLIENT_URL`: (leave empty, will use built-in client)

5. **Deploy** - Render will automatically deploy

Your app will be available at: `https://maze-bingo-auction.onrender.com`

## Option 2: Deploy to Digital Ocean App Platform

1. **Push code to GitHub** (same as above)

2. **Go to Digital Ocean App Platform**
   - Create new App
   - Connect GitHub repository
   - Choose region

3. **Configure App**:
   - **Build Command**: `npm install && npm run build`
   - **Run Command**: `npm start`
   - **HTTP Port**: 3001
   - **Environment Variables**:
     - `NODE_ENV`: production

4. **Deploy** - $5/month for basic instance

## Option 3: Deploy to Digital Ocean Droplet (More Control)

1. **Create a Droplet** (Ubuntu 22.04, $6/month)

2. **SSH into droplet and setup**:
   ```bash
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # Install PM2
   sudo npm install -g pm2

   # Clone your repo
   git clone YOUR_GITHUB_REPO_URL
   cd maze-bingo-auction

   # Install dependencies
   npm install
   cd client && npm install && cd ..

   # Build
   npm run build

   # Start with PM2
   NODE_ENV=production pm2 start dist/index.js --name maze-bingo

   # Setup PM2 to restart on reboot
   pm2 startup
   pm2 save

   # Install nginx (optional, for better performance)
   sudo apt install nginx
   ```

3. **Configure firewall**:
   ```bash
   sudo ufw allow 3001
   sudo ufw allow 'Nginx Full'
   sudo ufw enable
   ```

## Testing Your Deployment

Once deployed, share your app URL with friends:
- Render: `https://your-app-name.onrender.com`
- Digital Ocean App Platform: `https://your-app-name.ondigitalocean.app`
- Digital Ocean Droplet: `http://YOUR_DROPLET_IP:3001`

## Important Notes

- **WebSocket Support**: All options above support WebSockets for Socket.io
- **Free Tier Limitations**: Render free tier may sleep after inactivity (spins up on request)
- **Scaling**: Digital Ocean provides more control for scaling if needed

## Environment Variables for Production

When friends connect, the client will automatically use the same domain for the WebSocket connection. No additional configuration needed!