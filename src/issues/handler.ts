import * as core from "@actions/core";
import type { IssuesEvent } from "@octokit/webhooks-definitions/schema";
import { Octokit } from "octokit";
import { IssueParser } from "./parser";
import { NotGitClient } from "../notion/client";

interface IssueHandlerOptions {
  payload: IssuesEvent;
  octokit: Octokit;
  client: NotGitClient;
}

export class IssueHandler {
  private payload: IssuesEvent;
  private parser: IssueParser;
  private client: NotGitClient;

  constructor(options: IssueHandlerOptions) {
    this.payload = options.payload;
    this.parser = new IssueParser({
      payload: options.payload,
      octokit: options.octokit,
    });
    this.client = options.client;
  }

  async handleIssue() {
    if (this.payload.action === "opened") {
      await this.onIssueOpened();
    } else {
      await this.onIssueEdited();
    }
  }

  async handleSync() {
    const issuesToCreate = await this.client.fetchOnlyGithubIssues();
    await this.client.createIssuePages(issuesToCreate, this.parser);
  }

  async onIssueOpened() {
    core.info(`Creating page for issue #${this.payload.issue.number}`);

    await this.client.createIssuePage(this.parser);
  }

  async onIssueEdited() {
    core.info(
      `Querying database for page with github id ${this.payload.issue.id}`
    );

    const pages = await this.client.fetchIssuePages(this.payload.issue.id);

    core.info("Building body blocks");

    if (pages.length > 0) {
      const page = pages[0];

      core.info(`Query successful: Page ${page.id}`);
      core.info(`Updating page for issue #${this.payload.issue.number}`);
      await this.client.editIssuePage(pages[0], this.parser);
    } else {
      core.warning(
        `Could not find page with github id ${this.payload.issue.id}`
      );
    }
  }
}
