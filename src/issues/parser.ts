import * as core from "@actions/core";
import type { Issue, IssuesEvent } from "@octokit/webhooks-definitions/schema";
import { CustomValueMap, properties } from "../properties";
import { Octokit } from "octokit";
import { CustomTypes } from "../api-types";
import { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";

function removeHTML(text?: string): string {
  return text?.replace(/<.*>.*<\/.*>/g, "") ?? "";
}

interface ProjectData {
  name?: string;
  columnName?: string;
}

interface IssueParserOptions {
  payload: IssuesEvent;
  octokit: Octokit;
}

export class IssueParser {
  private payload: IssuesEvent;
  private octokit: Octokit;

  constructor(options: IssueParserOptions) {
    this.payload = options.payload;
    this.octokit = options.octokit;
  }

  async getProperties(): Promise<CustomValueMap> {
    const payload = this.payload;

    payload.issue.labels?.map((label) => label.color);

    const projectData = await IssueParser.getProjectData(
      payload.repository.full_name,
      payload.issue.number,
      this.octokit
    );

    core.debug(`Current project data: ${JSON.stringify(projectData, null, 2)}`);

    if (!payload.issue.state) {
      throw new Error("Issue state is not defined");
    }

    const result: CustomValueMap = {
      Name: properties.title(payload.issue.title),
      Status: properties.getStatusSelectOption(payload.issue.state),
      Organization: properties.text(payload.organization?.login ?? ""),
      Repository: properties.text(payload.repository.name),
      Number: properties.number(payload.issue.number),
      Assignees: properties.multiSelect(
        payload.issue.assignees.map((assignee) => assignee.login)
      ),
      Milestone: properties.text(payload.issue.milestone?.title ?? ""),
      Labels: properties.multiSelect(
        payload.issue.labels?.map((label) => label.name) ?? []
      ),
      Author: properties.text(payload.issue.user.login),
      Created: properties.date(payload.issue.created_at),
      Updated: properties.date(payload.issue.updated_at),
      ID: properties.number(payload.issue.id),
      Link: properties.url(payload.issue.html_url),
      Project: properties.text(projectData?.name || ""),
      "Project Column": properties.text(projectData?.columnName || ""),
    };

    return result;
  }

  getBody() {
    // TODO
    return [
      { text: { content: removeHTML(this.payload.issue.body) } },
    ] as CustomTypes.RichText["rich_text"];
  }

  getBodyBlocks(): Exclude<CreatePageParameters["children"], undefined> {
    // We're currently using only one paragraph block, but this could be extended to multiple kinds of blocks.
    return [
      {
        type: "paragraph",
        paragraph: {
          text: this.getBody(),
        },
      },
    ];
  }

  static async getProjectData(
    repo: string,
    issue: number,
    octokit: Octokit
  ): Promise<ProjectData | undefined> {
    const projects =
      (
        await octokit.rest.projects.listForRepo({
          owner: repo.split("/")[0],
          repo: repo.split("/")[1],
        })
      ).data || [];

    core.debug(`Found ${projects.length} projects.`);

    for (const project of projects) {
      const columns =
        (
          await octokit.rest.projects.listColumns({
            project_id: project.id,
          })
        ).data || [];

      for (const column of columns) {
        const cards = (
            await octokit.rest.projects.listCards({ column_id: column.id })
          ).data,
          card =
            cards &&
            cards.find(
              (c) => Number(c.content_url?.split("/issues/")[1]) === issue
            );

        if (card)
          return {
            name: project.name,
            columnName: column.name,
          };
      }
    }

    return undefined;
  }

  static createMultiSelectObjects(issue: Issue): {
    assigneesObject: string[];
    labelsObject: string[] | undefined;
  } {
    const assigneesObject = issue.assignees.map(
      (assignee: { login: string }) => assignee.login
    );
    const labelsObject = issue.labels?.map(
      (label: { name: string }) => label.name
    );
    return { assigneesObject, labelsObject };
  }
}
