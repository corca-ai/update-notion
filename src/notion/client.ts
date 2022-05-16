import { Client } from "@notionhq/client/build/src";
import * as core from "@actions/core";
import type { Issue } from "@octokit/webhooks-definitions/schema";
import { QueryDatabaseResponse } from "@notionhq/client/build/src/api-endpoints";
import { Octokit } from "octokit";
import { CustomTypes } from "../api-types";
import { IssueParser } from "../issues/parser";
import { properties } from "../properties";

interface IssueHandlerOptions {
  notion: Client;
  databaseId: string;
  octokit: Octokit;
  repo: string;
}

export class NotGitClient {
  private octokit: Octokit;
  private notion: Client;
  private databaseId: string;
  private repo: string;

  constructor(options: IssueHandlerOptions) {
    this.notion = options.notion;
    this.databaseId = options.databaseId;
    this.octokit = options.octokit;
    this.repo = options.repo;
  }

  async query({
    filter,
    page_size,
    start_cursor,
  }: {
    filter?: any;
    page_size?: number;
    start_cursor?: string;
  }): Promise<QueryDatabaseResponse> {
    return this.notion.databases.query({
      database_id: this.databaseId,
      filter,
      page_size,
      start_cursor,
    });
  }

  async fetchIssuePages(issueId: number) {
    const query = await this.notion.databases.query({
      database_id: this.databaseId,
      filter: {
        property: "ID",
        number: {
          equals: issueId,
        },
      },
      page_size: 1,
    });
    return query.results;
  }

  async changeIssueStatus(page: any, status: "open" | "closed" | "review") {
    return this.notion.pages.update({
      page_id: page.id,
      properties: {
        Status: properties.getStatusSelectOption(status),
      },
    });
  }

  async editIssuePage(page: any, parser: IssueParser) {
    const bodyBlocks = parser.getBodyBlocks();
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

    return this.notion.pages.update({
      page_id: page.id,
      properties: await parser.getProperties(),
    });
  }

  async createIssuePage(parser: IssueParser) {
    return this.notion.pages.create({
      parent: {
        database_id: this.databaseId,
      },
      properties: await parser.getProperties(),
      children: parser.getBodyBlocks(),
    });
  }

  async createIssuePages(issues: Issue[], parser: IssueParser) {
    await Promise.all(
      issues.map(async (issue) =>
        this.notion.pages.create({
          parent: { database_id: this.databaseId },
          properties: await parser.getPropertiesFromIssue(issue),
        })
      )
    );
  }

  async fetchNotionIssuePagesAll() {
    core.info("Checking for issues already in the database...");
    const pages: QueryDatabaseResponse["results"] = [];
    let cursor = undefined;
    let next_cursor: string | null = "true";
    while (next_cursor) {
      const response: QueryDatabaseResponse = await this.query({
        start_cursor: cursor,
      });
      next_cursor = response.next_cursor;
      const { results } = response;
      pages.push(...results);
      if (!next_cursor) {
        break;
      }
      cursor = next_cursor;
    }

    return pages;
  }

  pagesToIssueNumbers(pages: any[]): {
    pageId: string;
    issueNumber: number;
  }[] {
    const res: {
      pageId: string;
      issueNumber: number;
    }[] = [];

    pages.forEach((page) => {
      if ("properties" in page) {
        let num: number | null = null;
        num = (page.properties["Number"] as CustomTypes.Number)
          .number as number;
        if (typeof num !== "undefined")
          res.push({
            pageId: page.id,
            issueNumber: num,
          });
      }
    });

    return res;
  }

  async fetchGitHubIssues(): Promise<Issue[]> {
    core.info("Finding Github Issues...");
    const issues: Issue[] = [];
    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.issues.listForRepo,
      {
        owner: this.repo.split("/")[0],
        repo: this.repo.split("/")[1],
        state: "all",
        per_page: 100,
      }
    );
    for await (const { data } of iterator) {
      for (const issue of data) {
        if (!issue.pull_request) {
          issues.push(<Issue>issue);
        }
      }
    }
    return issues;
  }

  async fetchOnlyGithubIssues(): Promise<Issue[]> {
    const notionIssues = await this.fetchNotionIssuePagesAll();
    const githubIssues = await this.fetchGitHubIssues();

    const issueIds = this.pagesToIssueNumbers(notionIssues).map(
      (issue) => issue.issueNumber
    );
    const pagesToCreate: Issue[] = [];
    for (const issue of githubIssues) {
      if (!issueIds.includes(issue.number)) {
        pagesToCreate.push(issue);
      }
    }
    return pagesToCreate;
  }
}
