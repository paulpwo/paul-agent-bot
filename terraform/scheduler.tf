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
      Resource = aws_instance.paulagentbot.arn
    }]
  })
}

resource "aws_scheduler_schedule" "stop_nightly" {
  name        = "${var.project}-stop-nightly"
  description = "Stop PaulAgentBot EC2 at end of day"

  flexible_time_window { mode = "OFF" }

  schedule_expression          = var.scheduler_stop_cron
  schedule_expression_timezone = var.scheduler_timezone

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.paulagentbot.id] })
  }
}

resource "aws_scheduler_schedule" "start_daily" {
  name        = "${var.project}-start-daily"
  description = "Start PaulAgentBot EC2 at beginning of day"

  flexible_time_window { mode = "OFF" }

  schedule_expression          = var.scheduler_start_cron
  schedule_expression_timezone = var.scheduler_timezone

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.paulagentbot.id] })
  }
}

# ── Telegram notifications: EC2 start/stop (optional) ─────────────────────────
# Infrastructure-level alerts — notifies when the instance powers on or off.
# Enabled only when var.telegram_bot_token and var.telegram_chat_id are set.
# These are separate from PaulAgentBot's in-app notification system (business logic).

locals {
  telegram_notifications_enabled = var.telegram_bot_token != "" && var.telegram_chat_id != ""
}

resource "aws_iam_role" "eventbridge_api_dest" {
  count = local.telegram_notifications_enabled ? 1 : 0
  name  = "${var.project}-eventbridge-api-dest"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "eventbridge_api_dest" {
  count = local.telegram_notifications_enabled ? 1 : 0
  name  = "${var.project}-eventbridge-api-dest-policy"
  role  = aws_iam_role.eventbridge_api_dest[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "events:InvokeApiDestination"
      Resource = "*"
    }]
  })
}

resource "aws_cloudwatch_event_connection" "telegram" {
  count              = local.telegram_notifications_enabled ? 1 : 0
  name               = "${var.project}-telegram"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Dummy"
      value = "unused"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "telegram" {
  count                            = local.telegram_notifications_enabled ? 1 : 0
  name                             = "${var.project}-telegram-sendmessage"
  connection_arn                   = aws_cloudwatch_event_connection.telegram[0].arn
  invocation_endpoint              = "https://api.telegram.org/bot${var.telegram_bot_token}/sendMessage"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 10
}

resource "aws_cloudwatch_event_rule" "ec2_started" {
  count       = local.telegram_notifications_enabled ? 1 : 0
  name        = "${var.project}-ec2-started"
  description = "EC2 started → Telegram"

  event_pattern = jsonencode({
    source        = ["aws.ec2"]
    "detail-type" = ["EC2 Instance State-change Notification"]
    detail = {
      state         = ["running"]
      "instance-id" = [aws_instance.paulagentbot.id]
    }
  })
}

resource "aws_cloudwatch_event_target" "ec2_started_telegram" {
  count     = local.telegram_notifications_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.ec2_started[0].name
  target_id = "TelegramAlertStarted"
  arn       = aws_cloudwatch_event_api_destination.telegram[0].arn
  role_arn  = aws_iam_role.eventbridge_api_dest[0].arn

  input_transformer {
    input_paths = {
      instance_id = "$.detail.instance-id"
      time        = "$.time"
    }
    input_template = "{\"chat_id\":\"${var.telegram_chat_id}\",\"text\":\"▶️ PaulAgentBot EC2 started\\nInstance: <instance_id>\\nTime: <time>\"}"
  }
}

resource "aws_cloudwatch_event_rule" "ec2_stopped" {
  count       = local.telegram_notifications_enabled ? 1 : 0
  name        = "${var.project}-ec2-stopped"
  description = "EC2 stopped → Telegram"

  event_pattern = jsonencode({
    source        = ["aws.ec2"]
    "detail-type" = ["EC2 Instance State-change Notification"]
    detail = {
      state         = ["stopped"]
      "instance-id" = [aws_instance.paulagentbot.id]
    }
  })
}

resource "aws_cloudwatch_event_target" "ec2_stopped_telegram" {
  count     = local.telegram_notifications_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.ec2_stopped[0].name
  target_id = "TelegramAlertStopped"
  arn       = aws_cloudwatch_event_api_destination.telegram[0].arn
  role_arn  = aws_iam_role.eventbridge_api_dest[0].arn

  input_transformer {
    input_paths = {
      instance_id = "$.detail.instance-id"
      time        = "$.time"
    }
    input_template = "{\"chat_id\":\"${var.telegram_chat_id}\",\"text\":\"⏹️ PaulAgentBot EC2 stopped\\nInstance: <instance_id>\\nTime: <time>\"}"
  }
}
