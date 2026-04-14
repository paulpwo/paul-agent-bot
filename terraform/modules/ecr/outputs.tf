output "repository_url" {
  value = aws_ecr_repository.main.repository_url
}

output "repository_arn" {
  value = aws_ecr_repository.main.arn
}

output "registry_id" {
  value = aws_ecr_repository.main.registry_id
}
