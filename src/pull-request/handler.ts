import * as core from "@actions/core";
import type { PullRequestEvent } from "@octokit/webhooks-definitions/schema";
import { NotGitClient } from "../notion/client";

interface PullRequestHandlerOptions {
  payload: PullRequestEvent;
  client: NotGitClient;
}

export class PullRequestHandler {
  private payload: PullRequestEvent;
  private client: NotGitClient;

  constructor(options: PullRequestHandlerOptions) {
    this.payload = options.payload;
    this.client = options.client;
  }

  async handleOpen() {
    if (this.payload.action === "opened") {
      await this.onPullRequestOpened();
    }
  }

  async onPullRequestOpened() {
    let issueId: number;
    try {
      issueId = Number(this.payload.pull_request.issue_url.split("/").pop());
    } catch (e) {
      core.error("Issue number not found in pull request url");
      throw e;
    }

    const pages = await this.client.fetchIssuePages(
      Number(this.payload.pull_request.issue_url.split("/").pop())
    );

    core.info("Building body blocks");

    if (pages.length > 0) {
      const page = pages[0];

      core.info(`Query successful: Page ${page.id}`);
      core.info(`Updating page for issue #${issueId}`);
      await this.client.changeIssueStatus(pages[0], "review");
    } else {
      core.warning(`Could not find page with github id ${issueId}`);
    }
  }
}
