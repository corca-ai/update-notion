import { Client, LogLevel } from "@notionhq/client/build/src";
import * as core from "@actions/core";
import type { IssuesEvent } from "@octokit/webhooks-definitions/schema";
import type { WebhookPayload } from "@actions/github/lib/interfaces";
import { Octokit } from "octokit";
import { IssueHandler } from "./issues/handler";
import { IssueNotionClient } from "./issues/client";

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

  if (github.eventName === "issues") {
    const handler = new IssueHandler({
      notion: notionClient,
      databaseId: notion.databaseId,
      payload: github.payload as IssuesEvent,
      octokit,
    });
    await handler.handleIssue();
  } else if (github.eventName === "workflow_dispatch") {
    if (!github.payload.repository?.full_name) {
      throw new Error("Repository not found");
    }
    const handler = new IssueNotionClient({
      notion: notionClient,
      databaseId: notion.databaseId,
      repo: github.payload.repository?.full_name,
      octokit,
    });
    const issuesToCreate = await handler.fetchOnlyGithubIssues();
    await handler.createPages(issuesToCreate);
  }

  core.info("Complete!");
}
