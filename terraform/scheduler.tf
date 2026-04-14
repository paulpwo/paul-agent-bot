# ── EventBridge Scheduler — EC2 start/stop ────────────────────────────────────
# Automatically stops the instance overnight and starts it in the morning
# to reduce costs. Configured via scheduler_* variables in tfvars.

resource "aws_iam_role" "scheduler" {
  name = "${var.project}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "${var.project}-scheduler" }
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.project}-scheduler-policy"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:StartInstances", "ec2:StopInstances"]
      Resource = aws_instance.paulbot.arn
    }]
  })
}

resource "aws_scheduler_schedule" "stop_nightly" {
  name        = "${var.project}-stop-nightly"
  description = "Stop PaulBot EC2 at end of day"

  flexible_time_window { mode = "OFF" }

  schedule_expression          = var.scheduler_stop_cron
  schedule_expression_timezone = var.scheduler_timezone

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.paulbot.id] })
  }
}

resource "aws_scheduler_schedule" "start_daily" {
  name        = "${var.project}-start-daily"
  description = "Start PaulBot EC2 at beginning of day"

  flexible_time_window { mode = "OFF" }

  schedule_expression          = var.scheduler_start_cron
  schedule_expression_timezone = var.scheduler_timezone

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.paulbot.id] })
  }
}
