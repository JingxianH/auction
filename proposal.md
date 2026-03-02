# ECE1779 Course Project Proposal: Cloud-Native Auction Platform

**Group 2:** 
- Jingxian Hou - 1001159710
- Felipe Solano - 1002752032

## 1. Motivation
This project proposes a stateful auction platform that allows users to list items for time-boxed bidding. The platform targets “flash-sale” style auctions: when a creator with an audience starts an auction, bidding activity can spike and multiple bids can arrive at nearly the same time. The platform will enforce auction closing rules using server time and maintain data consistency under concurrent bidding so that each auction ends with a single correct winner and a reliable bid history.

Our target users consists of small merchants and independent crafters who want a simple way to run short auctions without relying on complex marketplace tools.  This project is worth pursuing because many general purpose platforms are not designed for safe bidding under concurrency, which is essential for reliable outcomes during high bidding periods.


## 2. Objective and Key Features

### 2.1 Objective
Build and deploy a stateful auction platform where users create auctions and place bids while maintaining data consistency under concurrent bidding. The system will be containerized and deployed on DigitalOcean Kubernetes with persistent PostgreSQL storage. It will ensure correct bid outcomes and preserve state across pod restarts, rolling deployments, and recovery scenarios

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
  - For production, PostgreSQL will run in-cluster as a StatefulSet with its data directory mounted to a DigitalOcean Block Storage PersistentVolumeClaim (PVC) to ensure durability across pod restarts and rescheduling

#### Deployment Provider: DigitalOcean
The platform will be deployed on:
- DigitalOcean Kubernetes for the API and PostgreSQL database workloads.
- 
Docker will be used for containerization during local development, using Docker Compose to manage API and database services.

#### Monitoring Setup

Monitoring will be implemented using DigitalOcean’s built-in monitoring and Kubernetes health checks.
We will aim for the following:
- Expose a `/health` endpoint and configure Kubernetes liveness and readiness probes
- Use DigitalOcean metrics for cluster and workload resource usage i.e. CPU and memory
- Configure at least one system level alert, such as high CPU/memory or repeated pod restarts (abnormal restart rates)
- If feasible, we will configure an alert for API failures, such as when the 5xx error rate exceeds a defined threshold
- Log key application events (auction creation, bid acceptance/rejection, auction finish) for debugging and demonstration purposes

  
### 2.3 Application Features
#### User accounts
- User registration and login with password hashing
- Basic authorization for placing bids so actions map to a user

#### Auction management
- Create auctions with title, description, starting price, and end time
- View active and completed auctions
- Enforce auction end time server-side using backend time as the source of truth

#### Concurrent Bidding
- Place bids on active auctions
- Reject bids not higher than the current highest bid or late bid
- A bid is valid only if received before `end_time` and it becomes the new highest bid. The server timestamp is the source of truth.
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
- Implement a Kubernetes `CronJob` to run periodic `pg_dump` backups of the PostgreSQL database
- Upload backups to DigitalOcean Spaces
- Document a recovery procedure and perform a recovery test:
  - Restore the database to a backup state from the cloud bucket, reconnect the API to the restored instance, and verify auction/bid consistency.
  - Include an integrity check that compares stored highest bid vs. MAX(bids) for each auction.

The goal of this feature is to showcase state durability and recovery correctness

#### Advanced Feature 3 (Optional): External Service Integration *Email Notifications*

- If time permits, we plan to integrate an external email service, such as SendGrid, to send event notifications. Emails will be triggered for key system events, such as auction completion, notifying the winner and creator. 

- To keep notifications consistent with the system state, the backend will call the external email API only after a successful database transaction commits. Email credentials will be stored using Kubernetes Secrets. The notification logic will be designed as a modular component so it can be enabled or disabled without affecting the bidding workflow.

The goal of this feature is to showcase integration with a third-party service and secure credential management, with a separation between the core system and external communication.

### 2.5 Scope and Feasibility

- The project scope is focused on backend reliability and infrastructure correctness rather than UI complexity
- We will build a REST API first and ensure it is fully containerized, deployed on Kubernetes, and backed by persistent PostgreSQL storage
- To keep the scope feasible for a two-person team, authentication will remain basic: users can register and log in, passwords will be hashed, and endpoints such as “create auction” and “place bid” will require authentication. We will not implement advanced identity features such as OAuth, email verification, or password recovery
- A social feed was considered early on, but it is out of scope for this project to reduce risk. If time permits, we may implement follow/unfollow and the option to filter “auctions from followed creators”. 

Overall this focused scope is to ensure feasibility within the timeframe for a two-person team, and it will allow depth in Kubernetes orchestration, persistence, deployment safety, and recovery validation.

## 3. Tentative Plan

### Phase 1: Backend API Development (Mar 1 – 10)
* **Auction Management (Jingxian):** Implement endpoints for item creation and auction duration settings. Optional image upload & reserve pricing (time permitting)
* **User & Bid Management (Felipe):** Develop account provisioning, core authentication and user identity, bid processing logic, and an auction status notification system.

### Phase 2: Cloud Infrastructure & Automation (Mar 11 – 20)
* **Orchestration & Failure Tolerance (Jingxian):** Provision DigitalOcean resources and deploy the app via Kubernetes. Validate availability under API pod failures and rolling deployments, and validate data recovery using CronJob backups (pg_dump) stored in DigitalOcean Spaces.
* **CI/CD Pipeline (Felipe):** Architect GitHub Actions workflows for automated container building and continuous deployment to the cluster.

### Phase 3: System Validation & Wrap-Up (Mar 21 – 25)
* **Testing & Polish (Both):** Execute active failover testing scenarios, finalize system documentation, and prepare the final presentation materials.


## 4. Initial Independent Reasoning (Before Using AI)
Before consulting AI, we established our primary learning objective: designing a stateful application that remains available under common failure scenarios and preserves correct state. The system must remain available during unexpected node failures, recover from common failure scenarios, and ensure persisted data is not lost or corrupted during an outage.

During early planning, we initially considered using a managed database service to reduce operational complexity. After reviewing the project requirements, we decided to deploy PostgreSQL inside our Kubernetes cluster using a StatefulSet with a PersistentVolumeClaim. This allows us to explicitly demonstrate persistent storage management and recovery validation within Kubernetes while keeping the database configuration simple

### 4.1 Architecture choices
We decided to containerize the backend API with Docker and develop locally with Docker Compose to mirror a multi-container setup (API + PostgreSQL). For deployment, we chose DigitalOcean and Kubernetes. We chose Kubernetes over Docker Swarm because, while Swarm is simpler to set up, Kubernetes is the industry standard used in some major tech companies to scale applications and it provides mature lifecycle management features. Using Deployments and Services will allow us to showcase scaling, pod replacement, and safe deployments. For persistence, we chose PostgreSQL as the system of record for users, auctions, and bids. Considering we are a two-person team, we plan to run PostgreSQL inside the Kubernetes cluster as a StatefulSet backed by a PersistentVolumeClaim, and keep schema migrations in the repository for reproducibility.

### 4.2 Anticipated challenges
A major challenge is Kubernetes' steep learning curve, especially since it is introduced later in the course. We will need to dedicate time to mastering core concepts like Deployments, Services, and Persistent Volumes. Secondly, validating  availability and recovery behavior will be complex. We must design active failure scenarios such as manually terminating server pods to confirm traffic is routed to another healthy replica and to perform a restore test for the database to verify that auction and bid state remains consistent after recovery

### 4.3 Early development approach
* **Local Development:** We will build the core functional backend APIs and test them locally using Docker Compose to ensure container compatibility.
* **Cloud Provisioning:** Once tested, we will provision infrastructure on DigitalOcean (likely using their managed Kubernetes service) to simplify control plane management.
* **Orchestration & Failure Tolerance:** We will deploy the application via Kubernetes with multiple replicas and add health probes to support automated recovery from pod failures. PostgreSQL will run as a StatefulSet backed by a PersistentVolumeClaim. We will implement scheduled backups using a Kubernetes CronJob and validate recovery through a restore test
* **Automation:** Finally, we will implement a CI/CD pipeline using GitHub Actions to automatically build our Docker images, push them to a container registry, and deploy updates to the cluster.

## 5. AI Assistance Disclosure
We used AI to evaluate our initial project idea. Originally, we wanted to build an AI agent that integrates with Google Maps so that it can automatically propose things to do while we are traveling. After we asked AI to check the feasibility of this project idea, AI suggested that this project scope was too big and that two people might not be able to complete it within a month. Hence, used AI to explore alternative project ideas after determining the original scope was too large.

After finishing the design and proposal, we asked AI to evaluate the overall design based on the requirements. AI highlighted that using a managed database might not demonstrate Kubernetes PV/PVC requirements clearly. Based on that feedback, we revised the design to run PostgreSQL in-cluster with a PVC and implement our own backup/restore process

In addition, we used AI to fix and refine wording and check for grammar, as well as to improve the sentence structures. Originally, the whole document consisted of giant paragraphs, and AI suggested to consolidate into bullet points so that it is easier to read and follow.

Architectural decisions and system design choices were made through team discussion. Our team held meetings to brainstorm all the features that we wanted to build and the technology that we wanted to use. One big motivation was to learn about the technology that we think is useful instead of asking AI what the best approach is.
