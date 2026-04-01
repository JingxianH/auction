# Cloud-Native Auction Platform — Final Report

**ECE1779 Introduction to Cloud Computing — Group 2**

## Team Information

| Name | Student Number | Email |
|------|---------------|-------|
| Jingxian Hou | 1001159710 | jingxian.hou@mail.utoronto.ca |
| Felipe Solano | 1002752032 | felipe.solano@mail.utoronto.ca |

## Motivation

Our team chose to build a stateful auction platform that supports "flash-sale" style auctions. Our system allows bidders to follow sellers like famous artists; this feature can lead to spikes in traffic when a popular seller starts an auction. The problem this addresses is straightforward: many general-purpose marketplace tools are not designed for safe bidding under concurrency, which can lead to incorrect outcomes such as duplicate winners or inconsistent bid histories.

Our target users are small merchants and independent crafters who want a simple way to run short, time-boxed auctions without relying on complex platforms. Building this project gave us the opportunity to tackle real-world challenges in data consistency, system availability, and Kubernetes-based orchestration—all directly aligned with the course objectives.

## Objectives

The main objective was to design and deploy a stateful cloud-native auction platform that:

- Supports user registration, JWT-based authentication, and profile management. The user should be able to follow other users
- Allows users to create, browse, edit, and cancel auctions (including private auctions visible only to followers)
- Ensures bidding correctness under concurrent access using PostgreSQL transactions and row-level locking. 
- Builds a backend long-running worker that monitors the life cycle of each auction, assigns winners for completed auctions, and integrates with a third-party application to send out email notifications
- Persists all application data in PostgreSQL with durable storage. The database snapshots will be backed up in DigitalOcean Spaces and allow developers to easily recover the database
- Deploys on DigitalOcean Kubernetes with rolling updates, health probes, and autoscaling
- Includes operational features: CI/CD pipeline through github action and terraform, monitoring with Prometheus-style metrics, automated database backup/recovery, and email notifications

## Technical Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Static HTML, CSS, JavaScript (served by Express) with Chart.js for monitoring dashboards |
| **Backend** | Node.js with Express |
| **Database** | PostgreSQL 15 (Alpine) |
| **Authentication** | JWT (jsonwebtoken) + bcrypt for password hashing |
| **Email Notifications** | Resend API |
| **Monitoring** | prom-client (Prometheus metrics), custom `/metrics` endpoint, Chart.js dashboards |
| **Containerization** | Docker, Docker Compose (local development) |
| **Orchestration** | Kubernetes (DigitalOcean Managed Kubernetes) |
| **Infrastructure Provisioning** | Terraform (DigitalOcean provider) |
| **CI/CD** | GitHub Actions |
| **Backup Storage** | DigitalOcean Spaces (S3-compatible object storage) |
| **Container Registry** | Docker Hub |

### Orchestration Approach: Kubernetes

We chose Kubernetes over Docker Swarm because Kubernetes is the industry standard for container orchestration and provides mature lifecycle management features. Our Kubernetes deployment includes:

- **API Deployment** with 2 replicas, rolling update strategy, liveness/readiness probes, and a Horizontal Pod Autoscaler (HPA) scaling from 2–6 replicas at 70% CPU
- **PostgreSQL StatefulSet** with a PersistentVolumeClaim backed by DigitalOcean Block Storage for data durability across pod restarts
- **Worker Deployment** — The worker pod monitors the life cycle of each auction; it is a long-running worker that performs a scan on active auctions
- **Cron Job** — The cron job is triggered by Kubernetes every day at midnight. It takes a snapshot of the PostgreSQL database and uploads the snapshot to DigitalOcean Spaces
- **Kubernetes Secrets** — These store database credentials, JWT secret, and email API keys


## Features

### Core Features

1. **User Accounts** — Users can register an account with a username, password, and email address that is used for notifications. We are using JWT-based authentication. Passwords are hashed with bcrypt (10 salt rounds). In addition, users can follow other users to join private auctions.

2. **Auction Management** — Authenticated users can create auctions with a title, description, starting price, and end time. Auctions can be edited (if no bids exist for price changes) or cancelled by the creator. Auctions support a **private mode** visible only to the creator's followers.

3. **Concurrent Bidding** — Bids are placed within a PostgreSQL transaction using `SELECT ... FOR UPDATE` row-level locking on the auction row. This prevents race conditions and ensures only one valid highest bid exists at any time. The server timestamp is the source of truth for auction expiration. Bids below the current highest or on expired/inactive auctions are rejected.

4. **Background Worker** — A dedicated worker container polls for completed auctions, determines winners, updates auction status, and sends email notifications. This is done through a third-party email service provider called Resend. It uses `FOR UPDATE SKIP LOCKED` to safely process auctions without conflicting with the API server. The transactional outbox pattern is used for reliable email delivery tracking.

5. **Follow/Unfollow System** — Users can follow other users. Private auctions are only visible to followers of the creator. Access control is enforced on all auction views and bid placements. This is the core feature that makes our platform different from any other auction website

### Advanced Features

6. **CI/CD Pipeline (GitHub Actions)** — We achieve CI/CD with GitHub Actions and Terraform scripts to provision our infrastructure. Every time a feature branch is merged to `main`, the pipeline performs the following steps to deploy the application to production:
   - Runs Terraform to ensure infrastructure is up to date (cluster, Spaces bucket, monitoring alerts)
   - Builds and pushes the Docker image to Docker Hub
   - Deploys to Kubernetes by applying manifests, running schema migrations, and restarting deployments
   - Verifies rollout status with `kubectl rollout status` (300s timeout)

7. **Backup and Recovery** — A Kubernetes CronJob runs daily `pg_dump` backups and uploads them to DigitalOcean Spaces, this job runs every day at midnight to generate the snapshot. The recovery process is purely manual; this is by design to avoid the system accidentally overwriting production data when there is a false alert.  A separate restore Job (`restore-job.yaml`) can restore the database from the latest backup in the bucket. The restore process drops and recreates the schema, then replays the SQL dump.

8. **Email Notifications (Resend)** — The platform sends emails for:
   - New bids on an auction (notifies the seller)
   - Auction completion (notifies winner, seller, and all losing bidders)
   - Auction expiration with no bids (notifies the seller)
   
   Email credentials are stored in Kubernetes Secrets. Notifications are sent after the database transaction commits to ensure consistency.

9. **Monitoring Dashboard** — The app exposes a Prometheus-compatible `/metrics` endpoint tracking:
   - HTTP request counts and durations (by method, route, status code)
   - Active auction count
   - Node.js process metrics (CPU, memory, event loop lag)
   
   The frontend includes a real-time monitoring tab with metric cards, latency breakdowns by route, and live-updating Chart.js graphs for memory, event loop P99, request counters, and per-route latency.

10. **Infrastructure Monitoring Alerts** — Terraform provisions DigitalOcean monitoring alerts for CPU > 80%, memory > 80%, and disk > 80% on cluster nodes, with email notifications.

11. **Horizontal Pod Autoscaler** — The API deployment scales automatically between 2 and 6 replicas based on CPU utilization (target: 70%).

## Individual Contributions

### Jingxian Hou

- Designed and implemented the core backend API (auction CRUD, bid placement with concurrent access control)
- Implemented the follow/unfollow system and private auction access control
- Designed and wrote the PostgreSQL schema (`init.sql`) with indexing and constraints
- Configured Kubernetes deployment manifests (`k8s-deploy.yaml`): StatefulSet, Deployments, PVC, HPA, health probes
- Set up Terraform for infrastructure provisioning and monitoring alerts
- Implemented the backup CronJob and restore Job for database recovery
- Built the frontend UI (`index.html`) with monitoring dashboard and Chart.js integration
- Wrote the final report and project documentation

### Felipe Solano

- Implemented user registration, login, and JWT authentication
- Developed the background worker (`worker.js`) for auction lifecycle management
- Integrated the Resend email service for winner, seller, loser, and expiration notifications
- Implemented the transactional outbox pattern for reliable notification delivery
- Designed and implemented the CI/CD pipeline with GitHub Actions (`deploy.yml`)
- Configured Docker Hub image builds and automated Kubernetes deployments
- Performed backup/recovery testing and validation
- Contributed to project documentation and proposal

