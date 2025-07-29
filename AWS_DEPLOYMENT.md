# AWS EC2 + RDS Deployment Guide

## Overview
This guide covers deploying CodeCrush to AWS using:
- **EC2**: Application hosting with Docker
- **RDS**: PostgreSQL database (managed)
- **Optional**: Elastic Load Balancer for high availability

## Prerequisites
- AWS Account with appropriate permissions
- Domain name (optional, for SSL/custom domain)

## Step 1: Create RDS PostgreSQL Database

### 1.1 Launch RDS Instance
```bash
# Via AWS CLI (optional)
aws rds create-db-instance \
    --db-instance-identifier codecrush-db \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version 15.4 \
    --master-username codecrush \
    --master-user-password YourSecurePassword123! \
    --allocated-storage 20 \
    --vpc-security-group-ids sg-xxxxxxxxx \
    --db-subnet-group-name your-subnet-group \
    --backup-retention-period 7 \
    --storage-encrypted
```

### 1.2 Via AWS Console
1. Go to **RDS → Create database**
2. **Engine**: PostgreSQL
3. **Version**: 15.4 or latest
4. **Template**: Free tier (for development) or Production
5. **Instance class**: `db.t3.micro` (free tier) or `db.t3.small`+
6. **Storage**: 20GB (can auto-scale)
7. **Username**: `codecrush`
8. **Password**: Create secure password
9. **VPC**: Same as your EC2 instance
10. **Public access**: No (access via EC2 only)
11. **Security group**: Create new or use existing with PostgreSQL access

### 1.3 Security Group Configuration
Create/update security group for RDS:
- **Type**: PostgreSQL
- **Port**: 5432
- **Source**: EC2 security group ID (not 0.0.0.0/0)

## Step 2: Launch EC2 Instance

### 2.1 Instance Configuration
- **AMI**: Ubuntu 22.04 LTS
- **Instance Type**: `t3.medium` (minimum for language servers)
- **Storage**: 20GB+ gp3 SSD
- **VPC**: Same as RDS
- **Security Group**: HTTP (3001), SSH (22)

### 2.2 Security Group for EC2
```
Port 22   (SSH)     - Your IP
Port 3001 (App)     - 0.0.0.0/0 (or ALB security group)
Port 80   (HTTP)    - 0.0.0.0/0 (if using ALB)
Port 443  (HTTPS)   - 0.0.0.0/0 (if using ALB)
```

## Step 3: Setup EC2 Instance

### 3.1 Initial Setup
```bash
# Connect to your EC2 instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install git and other tools
sudo apt install -y git curl htop

# Logout and login again for Docker group changes
exit
```

### 3.2 Deploy Application
AGALE - Piston docker instructions are in the piston directory.  Here is the short version
time scp -i ta-codecrush-key.pem piston-codecrush-2025-07-20-image.tar ubuntu@35.172.115.130:/home/ubuntu
time docker load < piston-codecrush-2025-07-20-image.tar
docker run --privileged -dit -p 2000:2000 -e PISTON_RUN_TIMEOUT=30000 -e PISTON_COMPILE_TIMEOUT=30000 -e PISTON_COMPILE_CPU_TIME=20000 --name piston-2025-07-20 piston-2025-07-20
# Make piston auto start in case ec2 instance is restarted
docker update --restart unless-stopped piston-2025-07-20
curl http://localhost:2000/api/v2/runtimes;date  (It takes 5-ish minutes for piston to be ready)

troubleshoot by installing netstat tools for this older Debian version named Buster
echo -e "deb http://archive.debian.org/debian/ buster main\ndeb http://archive.debian.org/debian/ buster-updates main\ndeb http://archive.debian.org/debian-security buster/updates main" > /etc/apt/sources.list
apt-get update
apt-get install -y net-tools
apt-get install -y curl
netstat -tulpn

```bash
# Clone repository
git clone https://github.com/andygale/codepad.git codecrush
cd codecrush

# Copy and configure environment
cp ec2-environment.example .env
nano .env  # Update with your RDS details
```

### 3.3 Configure Environment Variables
Update `.env` with your RDS details:
```env
NODE_ENV=production
PORT=3001

# RDS Database Configuration
DATABASE_URL=postgresql://codecrush:YourPassword@your-rds-endpoint.region.rds.amazonaws.com:5432/codecrush
DATABASE_SSL=true

# SECURITY: CORS Configuration (REQUIRED for production)
# Set this to your actual domain where the app will be hosted
CORS_ORIGIN=https://codecrush.yourdomain.com
# For multiple domains: CORS_ORIGIN=https://codecrush.yourdomain.com,https://www.codecrush.yourdomain.com

# Code Execution (choose one)
PISTON_API_URL=https://emkc.org/api/v2/piston/execute  # Public API
# PISTON_API_URL=https://your-piston.onrender.com/api/v2/execute  # Your Piston
# PISTON_API_URL=http://localhost:2000/api/v2/execute  # Local Piston

# SECURITY: Session Secret (REQUIRED - generate a strong random secret)
SESSION_SECRET=your-secure-random-session-secret-here

# Optional: Authentication
# GOOGLE_CLIENT_ID=your_google_client_id
# GOOGLE_CLIENT_SECRET=your_google_client_secret
```

## Step 4: Database Setup

### 4.1 Connect to RDS and Create Database
```bash
# Connect to RDS from EC2 (install psql if needed)
sudo apt install -y postgresql-client

# Connect to your RDS instance
psql -h your-rds-endpoint.region.rds.amazonaws.com -U codecrush -d postgres

If it doesn't connect, follow these steps

Step 1: Find Your EC2 Instance's Security Group
First, you need to know the ID of the security group your EC2 instance is using.
Navigate to the EC2 Dashboard in the AWS Console.
Click on Instances in the left sidebar.
Select your EC2 instance.
In the details pane below, click on the Security tab.
Copy the Security group ID (it will look like sg-0123456789abcdef).

Step 2: Add an Inbound Rule to Your RDS Security Group
Now, you'll tell your RDS database to accept connections from that EC2 security group.
Navigate to the RDS Dashboard in the AWS Console.
Click on Databases in the left sidebar and select your database instance (codecrush-db-instance-1).
Click on the Connectivity & security tab.
In the Security section, you'll see a link for VPC security groups. Click on it. This will take you back to the EC2 security group console, but with the RDS group selected.
Select the security group associated with your RDS instance.
In the details pane below, click on the Inbound rules tab.
Click the Edit inbound rules button.
Click Add rule.
Fill out the new rule's fields:
Type: Select PostgreSQL from the dropdown. This will automatically fill in the protocol (TCP) and port (5432).
Source: This is the critical step. Paste the EC2 security group ID you copied in Step 1 into the search box. Select it from the list.
Description (Optional): Add a note like Allow inbound from EC2 instance.
Click Save rules.
The changes are applied almost immediately.

# Create database
CREATE DATABASE codecrush;
\q
```

### 3.4 Initialize Database
```bash
# Run database migrations (first time only)
docker-compose -f docker-compose.prod.yml run --rm codecrush yarn --cwd server db:migrate
```

### 3.5 Deploy
```bash
# Make deploy script executable
chmod +x deploy.sh

# Update REPO_URL in deploy.sh
nano deploy.sh

# Run deployment
./deploy.sh
```

### 4.2 Run Migrations
```bash
# Run from your EC2 instance
cd codecrush
docker-compose -f docker-compose.prod.yml run --rm codecrush yarn --cwd server db:migrate
```

## Step 5: Domain and SSL (Optional)

### 5.1 Using Application Load Balancer
1. **Create Target Group**:
   - Type: Instance
   - Port: 3001
   - Health check path: `/api/info`

2. **Create Application Load Balancer**:
   - Internet-facing
   - Add your EC2 instance to target group
   - Configure SSL certificate (via ACM)

3. **Route 53** (if using custom domain):
   - Create A record pointing to ALB

### 5.2 Environment Updates for ALB
```env
# If behind ALB, update environment
TRUST_PROXY=true
```

## Step 6: Monitoring and Maintenance

### 6.1 CloudWatch Monitoring
```bash
# Install CloudWatch agent (optional)
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
sudo rpm -U ./amazon-cloudwatch-agent.rpm
```

### 6.2 Log Management
```bash
# View application logs
docker-compose -f docker-compose.prod.yml logs -f codecrush

# View system logs
sudo journalctl -u docker -f
```

### 6.3 Regular Maintenance
```bash
# Update application (run this when you push changes to GitHub)
./deploy.sh

# Update system packages (monthly)
sudo apt update && sudo apt upgrade -y

# Clean up Docker resources (weekly)
docker system prune -f
```

## Step 7: Scaling Considerations

### 7.1 Horizontal Scaling
- Use Auto Scaling Groups with your AMI
- Implement sticky sessions in load balancer
- Consider Redis for session storage

### 7.2 Database Scaling
- Use RDS Read Replicas for read-heavy workloads
- Enable Multi-AZ for high availability
- Monitor performance insights

## Cost Optimization

### Current Setup (Estimated Monthly)
- **EC2 t3.medium**: ~$30/month
- **RDS db.t3.micro**: ~$15/month (free tier first year)
- **Storage**: ~$5/month
- **Data transfer**: ~$5/month
- **Total**: ~$55/month

### Cost Savings
- Use Reserved Instances for 40% savings
- Use t4g instances (ARM) for 20% savings
- Right-size instances based on actual usage

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Check security groups
   # Verify RDS endpoint and credentials
   # Test connection from EC2:
   psql -h your-rds-endpoint -U codecrush -d codecrush
   ```

2. **Language Server Memory Issues**
   ```bash
   # Monitor memory usage
   docker stats
   
   # Upgrade instance if needed
   # t3.medium → t3.large
   ```

3. **Container Won't Start**
   ```bash
   # Check logs
   docker-compose -f docker-compose.prod.yml logs codecrush
   
   # Check environment variables
   docker-compose -f docker-compose.prod.yml config
   ```

## Security Best Practices

1. **Database Security**:
   - Use strong passwords
   - Enable encryption at rest
   - Regular security updates
   - No public access

2. **EC2 Security**:
   - Use IAM roles instead of access keys
   - Regular security updates
   - Principle of least privilege
   - Monitor with CloudTrail

3. **Application Security**:
   - Use HTTPS (via ALB + ACM)
   - Validate all inputs
   - Regular dependency updates
   - Monitor logs for suspicious activity

## Backup Strategy

### Automated Backups
- **RDS**: Automatic backups enabled (7-30 days)
- **Application**: Code in GitHub
- **Environment**: Store `.env` securely

### Manual Backups
```bash
# Database backup
pg_dump -h your-rds-endpoint -U codecrush codecrush > backup.sql

# Restore
psql -h your-rds-endpoint -U codecrush codecrush < backup.sql
``` 

AGALE - Setup BlueGreen Deployments
echo "upstream codecrush_upstream { server codecrush-blue:3001; }" | sudo tee /etc/nginx/upstream.conf
# For the very first deployment, you'll need to bring up both the blue environment and the nginx service.
docker-compose -f docker-compose.blue-green.yml up -d codecrush-blue nginx

# After this, you can run the ./deploy-blue-green.sh script for all subsequent deployments. The script will handle deploying to green, switching traffic, and taking blue offline. The next time you run it, it will deploy to blue, switch, and take green offline, and so on.
# You're now all set for zero-downtime blue-green deployments! Let me know if you have any other questions.

# Emergency switch-back
echo "upstream codecrush_upstream { server codecrush-blue:3001; }" | sudo tee /etc/nginx/upstream.conf
echo "upstream codecrush_upstream { server codecrush-green:3002; }" | sudo tee /etc/nginx/upstream.conf
sudo docker-compose -f docker-compose.blue-green.yml exec nginx nginx -s reload
