# ECE1779 Course Project Proposal: Cloud-Native Auction Platform

**Group 2:** 
- Jingxian Hou - 1001159710
- Felipe Solano - 1002752032

## 1. Motivation
This project introduces an auction platform that allows users to list their own items and enables buyers to follow their favorite sellers. This model differentiates itself from existing platforms by facilitating a "flash-sale" effect: when a prominent seller, such as a well-known artist, initiates an auction, a sudden influx of followers creates significant traffic spikes. Consequently, designing a highly available, high-throughput system is critical. Our target demographic consists of small merchants and independent crafters. We see substantial market potential in this space, as these creators currently lack specialized platforms tailored to their unique selling dynamics.

## 2. Objective and Key Features

### 2.1 Objective
Build and deploy a stateful auction platform where users create auctions and place bids while maintaining data consistency under concurrent bidding. The system will be containerized and deployed on DigitalOcean Kubernetes with persistent PostgreSQL storage. It will ensure correct bid outcomes and preserve state across pod restarts, rolling deployments, and backup-and-recovery scenarios

### 2.2 Core Technical Requirements

#### Orchestration Approach: Kubernetes
The backend API will be deployed to DigitalOcean Kubernetes using:
- A Kubernetes Deployment with multiple replicas for the API
- A Kubernetes Service for load balancing
- Rolling update strategy for zero downtime deployments
- Liveness and readiness probes for health monitoring

#### Database Schema and Persistent Storage
The application will use PostgreSQL as the primary database.

Core tables: `users`, `auctions`, `bids`

* **Main properties:**
  - Each auction has an `end_time`
  -  Bids reference both `auction_id` and `user_id`
  - The highest bid must always reflect the maximum valid bid

- **Consideration for data consistency:**
  - Bid placement will use database transactions
  - Row-level locking or atomic update logic will prevent race conditions
  - Server time will be the source of truth for auction expiration
  - For production deployment, DigitalOcean Managed PostgreSQL will be used to provide **persistent storage, automated backups, replication and durability** This will ensures state is preserved pod restarts, rolling deployments, and recovery scenarios.

#### Deployment Provider: DigitalOcean

The platform will be deployed on:
- DigitalOcean Kubernetes for the API
- DigitalOcean Managed PostgreSQL for the database

Docker will be used for containerization during local development, using Docker Compose to  manage API and database services

#### Monitoring Setup

Monitoring will be implemented using DigitalOcean’s built-in monitoring and Kubernetes health checks.
We will aim for the following:
- Expose a /health endpoint and configure Kubernetes liveness and readiness probes
- Monitor CPU and memory usage of API pods
- Configure alerts for abnormal restart rates
- Log key application events (auction creation, bid acceptance/rejection, auction finish) for debugging and demonstration purposes

  
### 2.3 Application Features
#### User accounts
- User registration and login
- Password hashing
- Basic authorization for placing bids

#### Auction management
- Create auctions with title, description, starting price, and end time
- View active and completed auctions
- Enforce auction end time server-side using backend time as the source of truth

#### Concurrent Bidding
- Place bids on active auctions
- Reject bids not higher than the current highest bid or late bid
- Store bid history per auction
- Ensure correctness in concurrency using PostgreSQL transactions and row-level locking so only one winning highest bid exists at any time

### 2.4 Advanced Features
#### Advanced Feature 1: CI/CD (GitHub Actions)

Implement a CI/CD pipeline that:
- Builds the Docker image on push to `main`
- Pushes the image to a container registry
- Deploys to Kubernetes using rolling updates
- Verifies rollout status using `kubectl rollout status` to keep the service available during deployments

#### Advanced Feature 2: Backup and Recovery
- Leverage DigitalOcean Managed PostgreSQL to perform automated backups
- Document a recovery procedure and perform a recovery test: restore the database to a backup state, reconnect the API to the restored instance, and verify auction/bid consistency including an integrity check that compares stored highest bid vs. `MAX(bids)` for each auction)

The goal of this feature is to showcase state durability and recovery correctness.

### 2.5 Scope and Feasibility

- The project scope is focused on backend reliability and infrastructure correctness, with less emphasis on UI complexity
- Basic authentication 
- Social graph/feed is a stretch goal, time permitted: implement follow/unfollow and the option to filter “auctions from followed creators”

This focused scope is to ensure feasibility within the course timeframe for a two-person team, and it will allow depth in Kubernetes orchestration, persistence, deployment safety, and recovery validation.

## 3. Tentative Plan

### Phase 1: Backend API Development (Mar 1 – 10)
* **Auction Management (Jingxian):** Implement endpoints for item creation, image handling, auction duration, and reserve pricing.
* **User & Bid Management (Felipe):** Develop account provisioning, user following, bid processing logic, and an auction status notification system.

### Phase 2: Cloud Infrastructure & Automation (Mar 11 – 20)
* **Orchestration & HA (Jingxian):** Provision DigitalOcean resources and deploy the app via Kubernetes. Implement and validate failover mechanisms for API pods and the database.
* **CI/CD Pipeline (Felipe):** Architect GitHub Actions workflows for automated container building and continuous deployment to the cluster.

### Phase 3: System Validation & Wrap-Up (Mar 21 – 25)
* **Testing & Polish (Both):** Execute active failover testing scenarios, finalize system documentation, and prepare the final presentation materials.


## 4. Initial Independent Reasoning (Before Using AI)
Before consulting AI, we established our primary learning objective: designing a real-world application capable of handling high production traffic with strict high availability (HA) and reliability. The system must remain available during unexpected node failures, implement robust failover strategies, and guarantee that persisted data is never lost or corrupted during an outage.

### 4.1 Architecture choices
We will containerize our backend APIs using Docker and orchestrate them with Kubernetes to run multiple replica pods, ensuring high availability. We chose Kubernetes over Docker Swarm because, while Swarm is simpler to set up, Kubernetes is the industry standard used by major tech companies to scale applications. It provides powerful lifecycle management features, such as automated rollouts, self-healing, and advanced traffic routing, which are essential for our HA goals.

### 4.2 Anticipated challenges
A major challenge is Kubernetes' steep learning curve, especially since it is introduced later in the ECE1779 course. We will need to dedicate time to mastering core concepts like Deployments, Services, and Persistent Volumes. Secondly, validating our HA and failover goals will be complex. We must design active failure scenarios—such as manually terminating server pods or simulating database crashes—to verify that the system successfully reroutes traffic and that persistent data remains intact.

### 4.3 Early development approach
* **Local Development:** We will build the core functional backend APIs and test them locally using Docker Compose to ensure container compatibility.
* **Cloud Provisioning:** Once tested, we will provision infrastructure on DigitalOcean (likely tiulizing their managed Kubernetes service) to simplify control plane management.
* **Orchestration & HA:** We will deploy the application via Kubernetes, configuring replica sets for server failover and setting up database replication with automated backups.
* **Suggestion: instead of setting up database replication, We will leverage DigitalOcean’s managed PostgreSQL service, which provides built-in replication and automated backups.**
* **Automation:** Finally, we will implement a CI/CD pipeline using GitHub Actions to automatically build our Docker images, push them to a container registry, and deploy updates to the cluster.

## 5. AI Assistance Disclosure
We used AI to evaluate our initial project idea. Originally, we wanted to build an AI agent that integrates with Google Maps so that it can automatically propose things to do while we are traveling. After we asked AI to check the feasibility of this project idea, AI suggested that this project scope was too big and that two people might not be able to complete it within a month. Hence, we used AI to come up with this auction platform project idea, which has decent complexity and requires cloud infrastructure to guarantee high availability.

In addition, we used AI to fix our grammar mistakes in the proposal doc, as well as to improve the sentence structures. Originally, the whole document consisted of giant paragraphs, and AI formatted some paragraphs into bullet points so that it is easier to read.

We wrote the "Key Features" and "Initial Independent Reasoning" sections without using AI. Our team held meetings to brainstorm all the features that we wanted to build and the technology that we wanted to use. One big motivation was to learn about the technology that we think is useful instead of asking AI what the best approach is.
