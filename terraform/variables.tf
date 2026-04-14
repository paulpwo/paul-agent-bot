variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "paulagentbot"
}

variable "project" {
  description = "Project name (used as resource name prefix)"
  type        = string
  default     = "paulagentbot"
}

variable "domain_name" {
  description = "Public domain name for PaulAgentBot (e.g. paulagentbot.yourdomain.com)"
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for auto DNS (leave empty to manage DNS manually)"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repo for OIDC trust (format: owner/repo)"
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "public_key_path" {
  description = "Path to SSH public key file"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed SSH access"
  type        = string
  default     = "0.0.0.0/0"
}

variable "root_volume_size" {
  description = "Root EBS volume size in GB (OS + Docker images)"
  type        = number
  default     = 20
}

variable "data_volume_size" {
  description = "Data EBS volume size in GB (SQLite DB + workspaces + Caddy certs)"
  type        = number
  default     = 20
}

variable "scheduler_stop_cron" {
  description = "Cron expression for stopping EC2 (in scheduler_timezone)"
  type        = string
  default     = "cron(30 22 * * ? *)"
}

variable "scheduler_start_cron" {
  description = "Cron expression for starting EC2 (in scheduler_timezone)"
  type        = string
  default     = "cron(0 7 ? * MON-SAT *)"
}

variable "scheduler_timezone" {
  description = "Timezone for EventBridge Scheduler cron expressions"
  type        = string
  default     = "America/Bogota"
}

# ── Scheduler Telegram notifications (optional) ───────────────────────────────
# When set, EventBridge sends a Telegram message when EC2 starts or stops.
# These are infrastructure-level notifications (instance on/off), not business logic.

variable "telegram_bot_token" {
  description = "Telegram bot token for EC2 start/stop notifications (leave empty to disable)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "telegram_chat_id" {
  description = "Telegram chat ID to receive EC2 start/stop notifications"
  type        = string
  default     = ""
}
