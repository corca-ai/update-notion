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

    const projectData = await this.getProjectData();

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

  async getProjectData(): Promise<ProjectData | undefined> {
    const repo = this.payload.repository.full_name;
    const projects =
      (
        await this.octokit.rest.projects.listForRepo({
          owner: repo.split("/")[0],
          repo: repo.split("/")[1],
        })
      ).data || [];

    core.debug(`Found ${projects.length} projects.`);

    for (const project of projects) {
      const columns =
        (
          await this.octokit.rest.projects.listColumns({
            project_id: project.id,
          })
        ).data || [];

      for (const column of columns) {
        const cards = (
            await this.octokit.rest.projects.listCards({ column_id: column.id })
          ).data,
          card =
            cards &&
            cards.find(
              (c) =>
                Number(c.content_url?.split("/issues/")[1]) ===
                this.payload.issue.number
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

    const projectData = await this.getProjectData();

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
