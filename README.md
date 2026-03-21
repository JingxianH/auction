# Cloud-Native Auction Platform

ECE1779 Intro to Cloud Computing  
Team Members:
- Felipe Solano
- Jingxian Hou

This repository contains the implementation of a stateful auction platform API built with Node.js, Express, and PostgreSQL. The application includes an API server and a background worker for handling auction logic.

## Prerequisites

- Node.js (v18 or later)
- Docker and Docker Compose
- For deployment: DigitalOcean account, kubectl, doctl (DigitalOcean CLI)

## Local Development

### Running with Docker Compose

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd auction
   ```

2. Start the services:
   ```bash
   docker-compose up --build
   ```

   This will start:
   - API server on `http://localhost:3000`
   - PostgreSQL database on `localhost:5432`
   - Background worker

3. The database will be initialized with the schema from `init.sql`.

### API Endpoints (local)

#### Authentication
- `POST /api/register` – create a new user
- `POST /api/login` – authenticate and receive a JWT

#### Auctions
- `POST /api/auctions` – create a new auction (requires `Authorization: Bearer <token>`)
- `GET /api/auctions` – list auctions (supports `?status=active|completed` and `?search=...`)
- `GET /api/auctions/:id` – get auction details (includes current highest bid)

#### Bids
- `POST /api/auctions/:id/bids` – place a bid (requires `Authorization: Bearer <token>`)
- `GET /api/auctions/:id/bids` – list bid history for an auction

### Winner notification via email

The worker now sends an email to the winner when an auction is marked `completed`.
Required environment variables for SMTP:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE` (true/false)
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`

Add these to your Docker Compose / Kubernetes secret configuration before starting the worker.

## Prerequisites
* **DigitalOcean Account** with a Read/Write Personal Access Token (PAT).
* **Installed Tools:** `terraform`, `kubectl`, and `doctl`.

## 1. Provision the Infrastructure (Terraform)
We use Terraform to automatically build a cost-optimized Kubernetes cluster on DigitalOcean.

```bash
# Export your DigitalOcean token
export DIGITALOCEAN_TOKEN="your_personal_access_token_here"

# Initialize Terraform and build the cluster (takes ~5-8 minutes)
terraform init
terraform apply -auto-approve
```
## SET up tokens
```
doctl kubernetes cluster kubeconfig save auction-cluster --access-token "$DIGITALOCEAN_TOKEN"
```

## Deployment
```

`# 1. Create database secrets
kubectl create secret generic db-secrets \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD=SuperSecret123 \
  --from-literal=POSTGRES_DB=auctiondb

# 2. Create application secrets (JWT + SMTP email)
kubectl create secret generic app-secrets \
  --from-literal=JWT_SECRET=<your-jwt-secret> \
  --from-literal=SMTP_HOST=smtp.gmail.com \
  --from-literal=SMTP_PORT=587 \
  --from-literal=SMTP_USER=<your-email@gmail.com> \
  --from-literal=SMTP_PASS=<your-gmail-app-password> \
  --from-literal=EMAIL_FROM=<your-email@gmail.com>

# 3. Deploy API, Worker, and Database
kubectl apply -f k8s-deploy.yaml

# 3. Apply infrastructure hotfixes (fixes DO block storage and K8s networking conflicts)
kubectl set env statefulset/postgres PGDATA=/var/lib/postgresql/data/pgdata
kubectl set env deployment/worker DB_PORT=5432
kubectl set env deployment/api DB_PORT=5432
kubectl delete pod postgres-0

```

## Initialize database

```
kubectl exec -i postgres-0 -- psql -U postgres -d auctiondb < init.sql
```

## TEST
```
# Find the EXTERNAL-IP
kubectl get nodes -o wide

# Send a POST request (Replace <EXTERNAL-IP> with the IP from above)
curl -X POST http://<EXTERNAL-IP>:30000/api/auctions \
-H "Content-Type: application/json" \
-d '{
  "title": "Reviewer Test Auction",
  "description": "Testing the deployment pipeline",
  "starting_price": 50.00,
  "end_time": "2026-03-15T12:00:00.000Z", 
  "creator_id": 1
}'
```

## Tear down

```
terraform destroy -auto-approve
```

## Create the schedule

```
kubectl apply -f backup-cronjob.yaml
```

## Create the job

```
kubectl create job --from=cronjob/db-backup manual-test-backup
```