import { Client } from "@notionhq/client/build/src";
import * as core from "@actions/core";
import type { IssuesEvent } from "@octokit/webhooks-definitions/schema";
import { Octokit } from "octokit";
import { IssueParser } from "./parser";

interface IssueHandlerOptions {
  notion: Client;
  databaseId: string;
  payload: IssuesEvent;
  octokit: Octokit;
}

export class IssueHandler {
  private notion: Client;
  private databaseId: string;
  private payload: IssuesEvent;
  private parser: IssueParser;

  constructor(options: IssueHandlerOptions) {
    this.notion = options.notion;
    this.databaseId = options.databaseId;
    this.payload = options.payload;
    this.parser = new IssueParser({
      payload: options.payload,
      octokit: options.octokit,
    });
  }

  async fetchDatabase() {
    const query = await this.notion.databases.query({
      database_id: this.databaseId,
      filter: {
        property: "ID",
        number: {
          equals: this.payload.issue.id,
        },
      },
      page_size: 1,
    });
    return query.results;
  }

  async handleIssue() {
    if (this.payload.action === "opened") {
      await this.onIssueOpened();
    } else {
      await this.onIssueEdited();
    }
  }

  async onIssueOpened() {
    core.info(`Creating page for issue #${this.payload.issue.number}`);

    await this.notion.pages.create({
      parent: {
        database_id: this.databaseId,
      },
      properties: await this.parser.getProperties(),
      children: this.parser.getBodyBlocks(),
    });
  }

  async onIssueEdited() {
    core.info(
      `Querying database for page with github id ${this.payload.issue.id}`
    );

    const database = await this.fetchDatabase();

    core.debug(`Query results: ${database}`);
    core.info("Building body blocks");
    const bodyBlocks = this.parser.getBodyBlocks();

    if (database.length > 0) {
      const page = database[0];

      core.info(`Query successful: Page ${page.id}`);
      core.info(`Updating page for issue #${this.payload.issue.number}`);

      const existingBlocks = (
        await this.notion.blocks.children.list({
          block_id: page.id,
        })
      ).results;

      const overlap = Math.min(bodyBlocks.length, existingBlocks.length);

      await Promise.all(
        bodyBlocks.slice(0, overlap).map((block, index) =>
          this.notion.blocks.update({
            block_id: existingBlocks[index].id,
            ...block,
          })
        )
      );

      if (bodyBlocks.length > existingBlocks.length) {
        await this.notion.blocks.children.append({
          block_id: page.id,
          children: bodyBlocks.slice(overlap),
        });
      } else if (bodyBlocks.length < existingBlocks.length) {
        await Promise.all(
          existingBlocks
            .slice(overlap)
            .map((block) => this.notion.blocks.delete({ block_id: block.id }))
        );
      }

      await this.notion.pages.update({
        page_id: page.id,
        properties: await this.parser.getProperties(),
      });
    } else {
      core.warning(
        `Could not find page with github id ${this.payload.issue.id}`
      );
    }
  }
}
