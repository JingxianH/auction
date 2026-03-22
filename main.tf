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

variable "alert_email" {
  description = "Email address to receive monitoring alerts"
  type        = string
  default     = ""
}

variable "enable_monitor_alerts" {
  description = "Create DigitalOcean monitor alerts (requires a verified email address in DO account)"
  type        = bool
  default     = false
}

variable "cluster_name" {
  description = "Existing DigitalOcean Kubernetes cluster name"
  type        = string
  default     = "auction-cluster"
}

variable "create_backup_bucket" {
  description = "Create a new Spaces bucket for backups. Keep false in CI to reuse an existing bucket."
  type        = bool
  default     = false
}

variable "backup_bucket_name" {
  description = "Existing backup bucket name to reuse, or desired name when creating a new bucket"
  type        = string
  default     = ""
}


provider "digitalocean" {
  # Terraform will still automatically use DIGITALOCEAN_TOKEN from your environment for the cluster
  spaces_access_id  = var.spaces_access_id
  spaces_secret_key = var.spaces_secret_key
}

# 1. Reuse existing Kubernetes Cluster by name
data "digitalocean_kubernetes_cluster" "auction_cluster" {
  name = var.cluster_name
}

# 2. Generate a random string only when creating a bucket without an explicit name
resource "random_id" "bucket_suffix" {
  count       = var.create_backup_bucket && trimspace(var.backup_bucket_name) == "" ? 1 : 0
  byte_length = 4
}

# 3a. Create backup bucket only when explicitly enabled
resource "digitalocean_spaces_bucket" "auction_backups" {
  count  = var.create_backup_bucket ? 1 : 0
  name   = trimspace(var.backup_bucket_name) != "" ? var.backup_bucket_name : "auction-backups-${random_id.bucket_suffix[0].hex}"
  region = "tor1"
  acl    = "private"
}

# 3b. Reuse existing backup bucket by name (default path for CI)
data "digitalocean_spaces_bucket" "auction_backups" {
  count  = var.create_backup_bucket || trimspace(var.backup_bucket_name) == "" ? 0 : 1
  name   = var.backup_bucket_name
  region = "tor1"
}

locals {
  backup_bucket_name = var.create_backup_bucket ? digitalocean_spaces_bucket.auction_backups[0].name : (trimspace(var.backup_bucket_name) != "" ? data.digitalocean_spaces_bucket.auction_backups[0].name : "")
}

# Output the required variables so you can easily copy them into your K8s secrets
output "cluster_id" {
  value = data.digitalocean_kubernetes_cluster.auction_cluster.id
}

output "backup_bucket_name" {
  value = local.backup_bucket_name
}

# ---------------------------------------------------------------------------
# Monitoring: DigitalOcean Alerts targeting the Kubernetes node pool
# DOKS automatically tags every node droplet with "k8s:<cluster-id>",
# so we target that tag to cover all nodes including auto-scaled ones.
# ---------------------------------------------------------------------------

resource "digitalocean_monitor_alert" "cpu_alert" {
  count = var.enable_monitor_alerts ? 1 : 0

  alerts {
    email = [var.alert_email]
  }
  window      = "5m"
  type        = "v1/insights/droplet/cpu"
  compare     = "GreaterThan"
  value       = 80
  enabled     = true
  description = "Auction cluster: node CPU usage > 80%"
  tags        = ["k8s:${data.digitalocean_kubernetes_cluster.auction_cluster.id}"]
}

resource "digitalocean_monitor_alert" "memory_alert" {
  count = var.enable_monitor_alerts ? 1 : 0

  alerts {
    email = [var.alert_email]
  }
  window      = "5m"
  type        = "v1/insights/droplet/memory_utilization_percent"
  compare     = "GreaterThan"
  value       = 80
  enabled     = true
  description = "Auction cluster: node memory usage > 80%"
  tags        = ["k8s:${data.digitalocean_kubernetes_cluster.auction_cluster.id}"]
}

resource "digitalocean_monitor_alert" "disk_alert" {
  count = var.enable_monitor_alerts ? 1 : 0

  alerts {
    email = [var.alert_email]
  }
  window      = "5m"
  type        = "v1/insights/droplet/disk_utilization_percent"
  compare     = "GreaterThan"
  value       = 80
  enabled     = true
  description = "Auction cluster: node disk usage > 80%"
  tags        = ["k8s:${data.digitalocean_kubernetes_cluster.auction_cluster.id}"]
}