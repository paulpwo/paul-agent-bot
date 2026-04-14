terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # State is stored locally in terraform.tfstate — keep it out of git (.gitignore covers it)
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# ── AMI + Default VPC ──────────────────────────────────────────────────────────

data "aws_ami" "ubuntu_2204" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_vpc" "default" {
  default = true
}

# ── ECR ────────────────────────────────────────────────────────────────────────

module "ecr" {
  source  = "./modules/ecr"
  project = var.project
}

# ── SSH Key Pair ───────────────────────────────────────────────────────────────

resource "aws_key_pair" "paulagentbot" {
  key_name   = "${var.project}-key"
  public_key = file(pathexpand(var.public_key_path))
  tags       = { Name = "${var.project}-key" }
}

# ── Security Group ─────────────────────────────────────────────────────────────

resource "aws_security_group" "paulagentbot" {
  name        = "${var.project}-sg"
  description = "PaulAgentBot EC2 - HTTP, HTTPS, SSH"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-sg" }
}

# ── IAM Instance Profile (EC2 → ECR pull) ─────────────────────────────────────

resource "aws_iam_role" "ec2" {
  name = "${var.project}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ec2_ecr" {
  name = "${var.project}-ec2-ecr"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = module.ecr.repository_arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "paulagentbot" {
  name = "${var.project}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# ── EC2 Instance ───────────────────────────────────────────────────────────────

resource "aws_instance" "paulagentbot" {
  ami                    = data.aws_ami.ubuntu_2204.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.paulagentbot.key_name
  vpc_security_group_ids = [aws_security_group.paulagentbot.id]
  iam_instance_profile   = aws_iam_instance_profile.paulagentbot.name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    delete_on_termination = true
    tags                  = { Name = "${var.project}-root" }
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    ecr_repo_url = module.ecr.repository_url
    aws_region   = var.aws_region
    domain       = var.domain_name
  })

  # Do NOT re-run user_data when variables change — bootstrap runs once
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"  # IMDSv2 required
    http_put_response_hop_limit = 1
  }

  tags       = { Name = "${var.project}" }
  depends_on = [module.ecr]
}

# ── Elastic IP ─────────────────────────────────────────────────────────────────

resource "aws_eip" "paulagentbot" {
  domain = "vpc"
  tags   = { Name = "${var.project}-eip" }
}

resource "aws_eip_association" "paulagentbot" {
  instance_id   = aws_instance.paulagentbot.id
  allocation_id = aws_eip.paulagentbot.id
}

# ── Data EBS Volume ────────────────────────────────────────────────────────────
# Separate from root — survives instance termination/replacement
# Contains: SQLite DB (/data/paulagentbot.db), workspaces (/data/workspaces), Caddy certs (/data/caddy)

resource "aws_ebs_volume" "data" {
  availability_zone = aws_instance.paulagentbot.availability_zone
  type              = "gp3"
  size              = var.data_volume_size
  tags              = { Name = "${var.project}-data" }

  lifecycle {
    # Prevent accidental deletion — detach manually before destroying
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name  = "/dev/xvdf"
  volume_id    = aws_ebs_volume.data.id
  instance_id  = aws_instance.paulagentbot.id
  force_detach = false
}

# ── GitHub Actions OIDC ────────────────────────────────────────────────────────
# Allows GitHub Actions to push images to ECR without long-lived AWS keys

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.project}-github-actions"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "${var.project}-github-actions-ecr"
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = module.ecr.repository_arn
      }
    ]
  })
}
