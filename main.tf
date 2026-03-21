terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "spaces_access_id" {
  description = "Access key for DigitalOcean Spaces"
  type        = string
  sensitive   = true
}

variable "spaces_secret_key" {
  description = "Secret key for DigitalOcean Spaces"
  type        = string
  sensitive   = true
}

provider "digitalocean" {
  # Terraform will still automatically use DIGITALOCEAN_TOKEN from your environment for the cluster
  spaces_access_id  = var.spaces_access_id
  spaces_secret_key = var.spaces_secret_key
}

data "digitalocean_kubernetes_versions" "current" {}

# 1. The Kubernetes Cluster
resource "digitalocean_kubernetes_cluster" "auction_cluster" {
  name    = "auction-cluster"
  region  = "tor1"
  version = data.digitalocean_kubernetes_versions.current.latest_version

  node_pool {
    name       = "budget-pool"
    size       = "s-2vcpu-2gb"
    node_count = 1
    auto_scale = true
    min_nodes  = 1
    max_nodes  = 3
  }
}

# 2. Generate a random string (Bucket names must be globally unique across all DigitalOcean users)
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# 3. The DigitalOcean Space (Backup Bucket)
resource "digitalocean_spaces_bucket" "auction_backups" {
  name   = "auction-backups-${random_id.bucket_suffix.hex}"
  region = "tor1"
  acl    = "private"
}

# Output the required variables so you can easily copy them into your K8s secrets
output "cluster_id" {
  value = digitalocean_kubernetes_cluster.auction_cluster.id
}

output "backup_bucket_name" {
  value = digitalocean_spaces_bucket.auction_backups.name
}