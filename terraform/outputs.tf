output "elastic_ip" {
  description = "Elastic IP — point your DNS A record here"
  value       = aws_eip.paulagentbot.public_ip
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.paulagentbot.id
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = "ssh ubuntu@${aws_eip.paulagentbot.public_ip}"
}

output "ecr_repository_url" {
  description = "ECR repository URL — use as PAULAGENTBOT_IMAGE base"
  value       = module.ecr.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = module.ecr.repository_arn
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC — set as AWS_ROLE_TO_ASSUME secret in GitHub"
  value       = aws_iam_role.github_actions.arn
}

output "data_volume_id" {
  description = "EBS data volume ID — reattach to new instance if instance is replaced"
  value       = aws_ebs_volume.data.id
}

output "ami_id" {
  description = "Ubuntu 22.04 AMI resolved at apply time"
  value       = data.aws_ami.ubuntu_2204.id
}
