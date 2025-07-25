## **AWS Application Setup Guide**

This guide outlines the steps to deploy your application components on Amazon Web Services (AWS), including a PostgreSQL database, a Piston code execution environment, and your Node.js server.

### **1\. Overview of AWS Services Used**

* **Amazon Virtual Private Cloud (VPC):** A logically isolated section of the AWS Cloud where you launch AWS resources. This provides a secure and private network for your application.  
* **Amazon Relational Database Service (RDS):** A managed database service that makes it easy to set up, operate, and scale a relational database. We'll use PostgreSQL.  
* **Amazon Elastic Compute Cloud (EC2):** A web service that provides resizable compute capacity in the cloud. We'll launch a virtual server (instance) here to host your Docker containers.  
* **Amazon Elastic Block Store (EBS):** Persistent block storage volumes for use with EC2 instances. We'll use this for your EC2 instance's disk, ensuring enough space for the large Piston image.  
* **AWS Identity and Access Management (IAM):** Manages access to AWS services and resources securely. (Implicitly used for user permissions).  
* **Security Groups:** Act as virtual firewalls that control inbound and outbound traffic to your instances and databases.

### **2\. Set Up Your AWS Virtual Private Cloud (VPC)**

It's best practice to create a custom VPC for your application for better network isolation and control.

1. **Navigate to VPC Dashboard:** Go to the AWS Management Console, search for "VPC", and click on the service.  
2. **Create VPC:**  
   * In the left navigation pane, click **Your VPCs**.  
   * Click **Create VPC**.  
   * Choose **VPC and more**.  
   * **Name tag auto-generation:** my-app-vpc  
   * **IPv4 CIDR block:** 10.0.0.0/16 (This is a common private IP range; you can adjust if needed).  
   * **Availability Zones (AZs):** Select 2 or more. **RDS requires a DB subnet group to span at least two Availability Zones for high availability.**  
   * **Public subnets:** 1 (or more, corresponding to your AZ selection)  
   * **Private subnets:** 1 (or more, corresponding to your AZ selection, for RDS)  
   * **NAT gateways:** None (not strictly necessary for this setup, but useful for private instances needing outbound internet access).  
   * **VPC endpoints:** None  
   * Click **Create VPC**.

### **3\. Set Up Amazon RDS for PostgreSQL**

This will host your small PostgreSQL database.

1. **Navigate to RDS Dashboard:** Go to the AWS Management Console, search for "RDS", and click on the service.  
2. **Create DB Subnet Group:**  
   * In the left navigation pane, click **Subnet groups**.  
   * Click **Create DB subnet group**.  
   * **Name:** my-app-db-subnet-group  
   * **Description:** Subnet group for my application database  
   * **VPC:** Select the my-app-vpc you just created.  
   * **Add subnets:** Select the Availability Zones you chose for your VPC and **add private subnets from at least two different Availability Zones** associated with your VPC (e.g., 10.0.1.0/24 in us-east-2a and 10.0.2.0/24 in us-east-2b). This is crucial for RDS multi-AZ deployment.  
   * Click **Create**.  
3. **Create RDS Database Instance:**  
   * In the left navigation pane, click **Databases**.  
   * Click **Create database**.  
   * **Choose a database creation method:** Standard create  
   * **Engine options:** PostgreSQL  
   * **Engine version:** Choose a recent stable version (e.g., PostgreSQL 15.x).  
   * **Templates:** Free tier (for testing/small scale) or Dev/Test (for more flexibility).  
   * **DB instance identifier:** my-app-db  
   * **Master username:** admin (or choose your own)  
   * **Master password:** Choose a strong password and remember it.  
   * **DB instance size:**  
     * For a small app, db.t3.micro (Free tier eligible) or db.t3.small is usually sufficient.  
   * **Storage:**  
     * **Storage type:** General Purpose SSD (gp2)  
     * **Allocated storage:** 20 GiB (Plenty for a small database, adjust as needed).  
   * **Connectivity:**  
     * **Virtual private cloud (VPC):** Select my-app-vpc.  
     * **DB subnet group:** Select my-app-db-subnet-group.  
     * **Publicly accessible:** No (Your EC2 instance in the same VPC will access it privately).  
     * **VPC security group (firewall):** Click **Create new**.  
       * **New VPC security group name:** my-app-db-sg  
       * This security group will initially allow access only from your EC2 instance.  
   * **Database authentication:** Password authentication  
   * **Additional configuration:**  
     * **Initial database name:** myappdb (optional, but good practice)  
   * Click **Create database**. This will take a few minutes.

### **4\. Set Up Amazon EC2 Instance for Docker Containers**

This EC2 instance will host both your Piston and Node.js Docker containers.

1. **Navigate to EC2 Dashboard:** Go to the AWS Management Console, search for "EC2", and click on the service.  
2. **Launch Instance:**  
   * Click **Launch instances**.  
   * **Name:** my-app-docker-host  
   * **Application and OS Images (Amazon Machine Image \- AMI):**  
     * Choose Ubuntu Server 22.04 LTS (HVM), SSD Volume Type (or Amazon Linux 2023). Ubuntu is generally user-friendly for Docker.  
   * **Instance type:**  
     * Given the 12.6GB Piston image and the need for your Node.js server, a t3.large (2 vCPUs, 8 GiB RAM) is a good starting point. A t3.medium (2 vCPUs, 4 GiB RAM) *might* work, but t3.large provides more breathing room.  
   * **Key pair (login):**  
     * Choose an existing key pair or **Create a new key pair**. If creating new, give it a name (e.g., my-app-key) and download the .pem file immediately. You'll need this to SSH into your instance.  
   * **Network settings:**  
     * **VPC:** Select my-app-vpc.  
     * **Subnet:** Select a **public subnet** associated with your VPC (e.g., 10.0.0.0/24).  
     * **Auto-assign public IP:** Enable (This makes your instance reachable from the internet).  
     * **Firewall (security groups):** Click **Create security group**.  
       * **Security group name:** my-app-ec2-sg  
       * **Description:** Security group for my application EC2 instance  
       * **Inbound security group rules:**  
         * **Rule 1 (SSH):**  
           * **Type:** SSH  
           * **Source type:** My IP (recommended for security) or Anywhere (less secure, but easier for initial testing).  
         * **Rule 2 (Node.js HTTP/S):**  
           * **Type:** HTTP (Port 80\)  
           * **Source type:** Anywhere  
           * **Type:** HTTPS (Port 443\)  
           * **Source type:** Anywhere  
           * *(If your Node.js server listens on a custom port, e.g., 3000, add a Custom TCP rule for that port from Anywhere).*  
   * **Configure storage:**  
     * The default root volume is often 8 GiB. **You MUST increase this.** For a 12.6GB Docker image plus OS and other containers, set it to at least 50 GiB (General Purpose SSD \- gp2). You can increase this later if needed.  
   * **Advanced details:** (No changes needed for this basic setup)  
   * Click **Launch instance**.

### **5\. Configure Security Group for RDS Access**

Your EC2 instance needs to be able to connect to the RDS database.

1. **Navigate to EC2 Dashboard:** Go to the AWS Management Console, search for "EC2", and click on the service.  
2. **Security Groups:** In the left navigation pane, click **Security Groups**.  
3. **Find my-app-db-sg:** Select the security group you created for your RDS database.  
4. **Edit Inbound Rules:**  
   * Click the **Inbound rules** tab, then **Edit inbound rules**.  
   * **Add rule:**  
     * **Type:** PostgreSQL (Port 5432\)  
     * **Source:** Select Custom and type in the name of your EC2 instance's security group (my-app-ec2-sg). This allows only traffic from your EC2 instance to reach the database.  
   * Click **Save rules**.

### **6\. Connect to EC2 Instance and Install Docker**

Now, you'll connect to your EC2 instance and prepare it for Docker.
AGALE - setup domain name and ssl certs - Use Let's Encrypt
AGALE - setup Eleastic IP address
AGALE - switch to AWS-DEPLOYMENT.md here

1. **Get EC2 Public IP:** In the EC2 Dashboard, click **Instances**, select your my-app-docker-host instance, and note its **Public IPv4 address**.  
2. **SSH into EC2:** Open a terminal on your local machine.  
   * Navigate to the directory where you saved your .pem key file.  
   * Change permissions of the key file:  
     chmod 400 my-app-key.pem

   * Connect via SSH (replace my-app-key.pem with your key file name and your\_public\_ip with your EC2 instance's public IP):  
     ssh \-i "my-app-key.pem" ubuntu@your\_public\_ip

     (If you chose Amazon Linux, the user would be ec2-user instead of ubuntu.)  
3. **Install Docker:** Once connected, run the following commands:  
   \# Update package lists  
   sudo apt update

   \# Install necessary packages for Docker  
   sudo apt install \-y ca-certificates curl gnupg lsb-release

   \# Add Docker's official GPG key  
   sudo mkdir \-m 0755 \-p /etc/apt/keyrings  
   curl \-fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg \--dearmor \-o /etc/apt/keyrings/docker.gpg

   \# Set up the Docker repository  
   echo \\  
     "deb \[arch=$(dpkg \--print-architecture) signed-by=/etc/apt/keyrings/docker.gpg\] https://download.docker.com/linux/ubuntu \\  
     $(lsb\_release \-cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list \> /dev/null

   \# Install Docker Engine  
   sudo apt update  
   sudo apt install \-y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

   \# Add your user to the docker group to run Docker commands without sudo  
   sudo usermod \-aG docker ubuntu

   \# Log out and log back in for the group change to take effect  
   exit

   *After logging out, SSH back into your instance to apply the Docker group changes.*  
4. **Verify Docker Installation:**  
   docker run hello-world

   You should see a "Hello from Docker\!" message.

### **7\. Run Your Docker Containers**

Now you'll pull and run your Piston and Node.js server containers.

**Important:** You'll need to replace your-piston-image and your-node-server-image with the actual names of your Docker images. If they are private, you'll need to docker login first.

1. **Pull Docker Images:**  
   docker pull your-piston-image  
   docker pull your-node-server-image

   *(Note: The Piston image (12.6GB) will take a significant amount of time to download, depending on your instance's network speed.)*  
2. Run Piston Container (Privileged Mode):  
   Piston typically exposes an API on a specific port (e.g., 2000 or 8000). We'll map this to the host.  
   docker run \-d \\  
     \--name piston-server \\  
     \--privileged \\  
     \-p 8000:2000 \\  
     your-piston-image

   * \-d: Runs the container in detached mode (in the background).  
   * \--name piston-server: Assigns a name to the container for easy reference.  
   * \--privileged: Grants the container all capabilities to the host machine. **Use with caution**, as this is a security risk if the container is compromised. It's required by Piston for certain functionalities.  
   * \-p 8000:2000: Maps port 8000 on the EC2 host to port 2000 inside the Piston container (assuming Piston listens on 2000). Adjust 2000 if your Piston image uses a different internal port.  
3. Run Node.js Server Container:  
   Your Node.js server needs to connect to the RDS database and the Piston container. We'll use environment variables for the database connection and host.docker.internal (or direct IP if on the same network) for Piston.  
   First, get your RDS endpoint:  
   * Go to the RDS Dashboard \-\> Databases \-\> my-app-db.  
   * Under "Connectivity & security", find the **Endpoint** (e.g., my-app-db.abcdef123456.us-east-1.rds.amazonaws.com).

   docker run \-d \\  
       \--name node-server \\  
       \-p 80:3000 \\  
       \-p 443:3000 \\  
       \--env DB\_HOST="your-rds-endpoint.us-east-1.rds.amazonaws.com" \\  
       \--env DB\_PORT="5432" \\  
       \--env DB\_USER="admin" \\  
       \--env DB\_PASSWORD="your\_strong\_password" \\  
       \--env DB\_NAME="myappdb" \\  
       \--env PISTON\_API\_URL="http://host.docker.internal:8000" \\  
       your-node-server-image

   * \-p 80:3000 \-p 443:3000: Maps host ports 80 (HTTP) and 443 (HTTPS) to port 3000 inside your Node.js container (assuming your Node.js server listens on 3000). Adjust 3000 if your Node.js server uses a different internal port.  
   * \--env: Sets environment variables inside the container.  
     * DB\_HOST, DB\_PORT, DB\_USER, DB\_PASSWORD, DB\_NAME: These are crucial for your Node.js server to connect to RDS. **Replace placeholders with your actual RDS endpoint and credentials.**  
     * PISTON\_API\_URL: This tells your Node.js server where to find the Piston API. http://host.docker.internal:8000 is a special Docker DNS name that resolves to the host machine's IP, allowing the Node.js container to reach the Piston container running on the same EC2 instance via the mapped port. If host.docker.internal doesn't work (e.g., older Docker versions), you might need to use the EC2 instance's private IP (e.g., http://10.0.0.x:8000).

### **8\. Configuration for Your Node.js Server**

Inside your Node.js application, you'll typically use a PostgreSQL client library (like pg) and an HTTP client (like axios or node-fetch) to connect to your services.

**Example Node.js Database Connection (using pg):**

const { Pool } \= require('pg');

const pool \= new Pool({  
  user: process.env.DB\_USER,  
  host: process.env.DB\_HOST,  
  database: process.env.DB\_NAME,  
  password: process.env.DB\_PASSWORD,  
  port: process.env.DB\_PORT,  
  ssl: {  
    rejectUnauthorized: false // Use this for development/testing; for production, configure proper SSL certificates.  
  }  
});

async function testDbConnection() {  
  try {  
    const client \= await pool.connect();  
    console.log('Successfully connected to PostgreSQL database\!');  
    const res \= await client.query('SELECT NOW()');  
    console.log('Current database time:', res.rows\[0\].now);  
    client.release();  
  } catch (err) {  
    console.error('Database connection error:', err.stack);  
  }  
}

testDbConnection();

**Example Node.js Piston Connection (using axios):**

const axios \= require('axios');

const pistonApiUrl \= process.env.PISTON\_API\_URL || 'http://localhost:8000'; // Fallback

async function executeCode(language, code) {  
  try {  
    const response \= await axios.post(\`${pistonApiUrl}/execute\`, {  
      language: language,  
      source: code,  
      // Add other Piston specific parameters if needed  
    });  
    console.log('Piston execution result:', response.data);  
    return response.data;  
  } catch (error) {  
    console.error('Error calling Piston API:', error.response ? error.response.data : error.message);  
    throw error;  
  }  
}

// Example usage:  
// executeCode('python', 'print("Hello from Piston\!")');

### **9\. Important Considerations**

* **Security Best Practices:**  
  * **Least Privilege:** Always configure security groups and IAM roles with the minimum necessary permissions.  
  * **Environment Variables:** Never hardcode sensitive information (like database passwords) directly in your Docker images or code. Use environment variables, AWS Secrets Manager, or AWS Systems Manager Parameter Store.  
  * **SSH Key Security:** Keep your .pem key file secure and private.  
  * **Privileged Mode:** Understand the security implications of \--privileged mode for Piston.  
* **Monitoring:** Set up CloudWatch alarms for your EC2 instance (CPU utilization, disk space) and RDS instance (database connections, storage).  
* **Cost Management:** Monitor your AWS costs regularly. The t3.large instance and increased EBS volume will incur costs. Consider Free Tier options for initial testing.  
* **Domain Name:** If you want your app to be accessible via a custom domain (e.g., myapp.com), you'll need to set up Amazon Route 53 and point your domain to the EC2 instance's Public IP (or an Elastic IP if you want a static public IP).  
* **HTTPS/SSL:** For production, you'll want to enable HTTPS. You can use a load balancer (Application Load Balancer) with AWS Certificate Manager, or configure Nginx/Caddy on your EC2 instance to handle SSL termination.

This setup provides a robust foundation for your application on AWS. Remember to replace placeholder values with your actual details and adjust configurations based on your specific application requirements.