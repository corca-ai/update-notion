import { Client } from "@notionhq/client/build/src";
import * as core from "@actions/core";
import type { Issue } from "@octokit/webhooks-definitions/schema";
import { QueryDatabaseResponse } from "@notionhq/client/build/src/api-endpoints";
import { Octokit } from "octokit";
import { CustomTypes } from "../api-types";
import { IssueParser } from "./parser";
import { CustomValueMap, properties } from "../properties";

interface IssueHandlerOptions {
  notion: Client;
  databaseId: string;
  octokit: Octokit;
  repo: string;
}

export class IssueNotionClient {
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

  async fetchNotionIssuePages() {
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
    const notionIssues = await this.fetchNotionIssuePages();
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

  async createPages(pagesToCreate: Issue[]): Promise<void> {
    await Promise.all(
      pagesToCreate.map(async (issue) =>
        this.notion.pages.create({
          parent: { database_id: this.databaseId },
          properties: await this.getPropertiesFromIssue(issue),
        })
      )
    );
  }

  async getPropertiesFromIssue(issue: Issue): Promise<CustomValueMap> {
    const {
      number,
      title,
      state,
      id,
      milestone,
      created_at,
      updated_at,
      repository_url,
      user,
      html_url,
    } = issue;
    const author = user?.login;
    const { assigneesObject, labelsObject } =
      IssueParser.createMultiSelectObjects(issue);
    const urlComponents = repository_url.split("/");
    const org = urlComponents[urlComponents.length - 2];
    const repo = urlComponents[urlComponents.length - 1];

    const projectData = await IssueParser.getProjectData(
      `${org}/${repo}`,
      issue.number,
      this.octokit
    );

    // These properties are specific to the template DB referenced in the README.
    return {
      Name: properties.title(title),
      Status: properties.getStatusSelectOption(state!),
      Organization: properties.text(org),
      Repository: properties.text(repo),
      Number: properties.number(number),
      Assignees: properties.multiSelect(assigneesObject),
      Milestone: properties.text(milestone ? milestone.title : ""),
      Labels: properties.multiSelect(labelsObject ? labelsObject : []),
      Author: properties.text(author),
      Created: properties.date(created_at),
      Updated: properties.date(updated_at),
      ID: properties.number(id),
      Link: properties.url(html_url),
      Project: properties.text(projectData?.name || ""),
      "Project Column": properties.text(projectData?.columnName || ""),
    };
  }
}
