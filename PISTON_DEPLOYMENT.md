# Deploying Piston Code Execution Engine on Render.com

This guide will help you deploy your own Piston instance on Render.com for secure, scalable code execution.

## Why Deploy Your Own Piston?

- **No Rate Limits**: The public Piston API is limited to 5 requests/second
- **Better Performance**: Dedicated instance closer to your main app
- **Reliability**: No dependency on public service availability
- **Customization**: Control which languages and versions are available

## Quick Deploy Options

### Option 1: One-Click Deploy (Recommended)

1. **Fork this repository** or create a new repo with the Piston files
2. **Push the Dockerfile.piston and render.yaml** to your repo
3. **Connect to Render.com**:
   - Go to [Render.com Dashboard](https://dashboard.render.com)
   - Click "New" → "Blueprint"
   - Connect your GitHub repo
   - Render will automatically detect the `render.yaml` file
   - Click "Apply"

### Option 2: Manual Deploy

1. **Create a new Web Service** on Render.com
2. **Connect your repository**
3. **Configure the service**:
   - **Name**: `codecrush-piston`
   - **Language**: `Docker`
   - **Dockerfile Path**: `./Dockerfile.piston`
   - **Plan**: `Starter` (or higher for production)
   - **Region**: Choose closest to your main app

4. **Set Environment Variables**:
   ```
   PISTON_LOG_LEVEL=INFO
   PISTON_BIND_ADDR=0.0.0.0:2000
   ```

5. **Deploy**

## Configure Your CodeCrush App

Once your Piston instance is deployed, update your main CodeCrush app:

### For Local Development
Keep using local Piston:
```bash
# Keep your local Piston running
yarn piston:start
```

### For Production (Render.com)
Set the environment variable in your main CodeCrush service:

1. Go to your main CodeCrush service on Render.com
2. Go to "Environment" tab
3. Add environment variable:
   ```
   PISTON_API_URL=https://your-piston-service.onrender.com/api/v2/execute
   ```
   Replace `your-piston-service` with your actual Piston service name.

## Testing Your Piston Instance

### 1. Check if it's running
Visit: `https://your-piston-service.onrender.com/api/v2/runtimes`

You should see a JSON response with available languages.

### 2. Test code execution
```bash
curl -X POST https://your-piston-service.onrender.com/api/v2/execute \
  -H "Content-Type: application/json" \
  -d '{
    "language": "javascript",
    "version": "20.11.1",
    "files": [{"content": "console.log(\"Hello from your Piston!\")"}]
  }'
```

## Available Languages

Your Piston instance will come with these languages pre-installed:
- JavaScript (Node.js)
- Python
- C++
- Java
- TypeScript
- Deno
- Swift
- Kotlin
- And many more...

## Managing Languages

To add or remove languages, you'll need to:

1. **SSH into your Piston service** (available on paid plans)
2. **Use the Piston CLI**:
   ```bash
   # List available packages
   cli/index.js ppman list
   
   # Install a language
   cli/index.js ppman install python=3.11.0
   
   # Remove a language
   cli/index.js ppman uninstall python=3.9.0
   ```

## Cost Considerations

- **Starter Plan**: $7/month - Good for development and light usage
- **Standard Plan**: $25/month - Better for production with auto-scaling
- **Pro Plan**: $85/month - High performance with dedicated resources

## Security Features

Piston includes robust security:
- ✅ Sandboxed execution using Linux containers
- ✅ Resource limits (CPU, memory, time)
- ✅ Network isolation
- ✅ Process limits
- ✅ File system isolation

## Troubleshooting

### Service Won't Start
- Check the build logs in Render.com dashboard
- Ensure Dockerfile.piston is in the repository root
- Verify the Docker image is accessible

### Code Execution Fails
- Check if the language is installed: `/api/v2/runtimes`
- Verify the language version in your request
- Check Piston service logs for errors

### Connection Issues
- Ensure PISTON_API_URL points to the correct service URL
- Check if the Piston service is running (green status)
- Verify network connectivity between services

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PISTON_API_URL` | `http://localhost:2000/api/v2/execute` | Your Piston instance URL |
| `PISTON_LOG_LEVEL` | `INFO` | Logging level for Piston |
| `PISTON_BIND_ADDR` | `0.0.0.0:2000` | Address Piston binds to |

## Next Steps

1. ✅ Deploy Piston using this guide
2. ✅ Update your main app's PISTON_API_URL
3. ✅ Test code execution
4. 🔄 Monitor performance and adjust plan if needed
5. 🔄 Set up monitoring/alerts for your Piston service

## Support

- **Piston Documentation**: https://github.com/engineer-man/piston
- **Render.com Docs**: https://render.com/docs/docker
- **Issues**: Create an issue in your repository 