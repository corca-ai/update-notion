import { Client, LogLevel } from "@notionhq/client/build/src";
import * as core from "@actions/core";
import type {
  IssuesEvent,
  PullRequestEvent,
} from "@octokit/webhooks-definitions/schema";
import type { WebhookPayload } from "@actions/github/lib/interfaces";
import { Octokit } from "octokit";
import { IssueHandler } from "./issues/handler";
import { NotGitClient } from "./notion/client";
import { PullRequestHandler } from "./pull-request/handler";

interface Options {
  notion: {
    token: string;
    databaseId: string;
  };
  github: {
    payload: WebhookPayload;
    eventName: string;
    token: string;
  };
}

export async function run(options: Options) {
  const { notion, github } = options;

  core.info("Starting...");

  const notionClient = new Client({
    auth: notion.token,
    logLevel: core.isDebug() ? LogLevel.DEBUG : LogLevel.WARN,
  });
  const octokit = new Octokit({ auth: github.token });
  const payload = github.payload;

  if (!payload.repository?.full_name) {
    throw new Error("Repository name is not provided");
  }

  const client = new NotGitClient({
    notion: notionClient,
    databaseId: notion.databaseId,
    repo: payload.repository?.full_name,
    octokit,
  });

  if (github.eventName === "issues") {
    const handler = new IssueHandler({
      client,
      payload: payload as IssuesEvent,
      octokit,
    });
    await handler.handleIssue();
  } else if (github.eventName === "workflow_dispatch") {
    const handler = new IssueHandler({
      client,
      payload: payload as IssuesEvent,
      octokit,
    });
    await handler.handleSync();
  } else if (github.eventName === "pull_request") {
    const handler = new PullRequestHandler({
      client,
      payload: payload as PullRequestEvent,
    });
    await handler.handleOpen();
  }

  core.info("Complete!");
}
