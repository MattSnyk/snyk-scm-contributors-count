import {
  BitbucketServerTarget,
  Username,
  Contributor,
  ContributorMap,
} from '../types';
import { Commits, Repo } from './types';
import { fetchAllPages, isAnyCommitMoreThan90Days } from './utils';

import * as debugLib from 'debug';

const debug = debugLib('snyk:bitbucket-server-count');

export const fetchBitbucketContributors = async (
  bitbucketServerInfo: BitbucketServerTarget,
  SnykMonitoredRepos: string[],
): Promise<ContributorMap> => {
  const contributorsMap = new Map<Username, Contributor>();
  try {
    let repoList: Repo[] = [];

    if (
      bitbucketServerInfo.repo &&
      (!bitbucketServerInfo.projectKeys ||
        bitbucketServerInfo.projectKeys.length > 1)
    ) {
      // If repo is specified, then a single project key is expected, bail otherwise
      console.log('You must provide a single project for single repo counting');
      process.exit(1);
    } else if (bitbucketServerInfo.repo) {
      // If repo is specified, and we got a single project key
      debug('Counting contributors for single repo');
      repoList.push({
        name: bitbucketServerInfo.repo,
        project: { key: bitbucketServerInfo.projectKeys![0] },
      });
    } else {
      // Otherwise retrieve all repos (for given projects or all repos)
      repoList = repoList.concat(
        await fetchBitbucketReposForProjects(bitbucketServerInfo),
      );
    }

    if (SnykMonitoredRepos && SnykMonitoredRepos.length > 0) {
      repoList = repoList.filter(
        (repo) =>
          SnykMonitoredRepos.includes(`${repo.project.key}/${repo.name}`) ||
          SnykMonitoredRepos.includes(`${repo.project.name}/${repo.name}`),
      );
    }

    for (let i = 0; i < repoList.length; i++) {
      await fetchBitbucketContributorsForRepo(
        bitbucketServerInfo,
        repoList[i],
        contributorsMap,
      );
    }
    debug(contributorsMap);
    return contributorsMap;
  } catch (err) {
    debug('Failed to retrieve contributors from bitbucket-server.\n' + err);
    console.log(
      'Failed to retrieve contributors from bitbucket-server. Try running with `DEBUG=snyk* snyk-contributor`',
    );
  }
  debug(contributorsMap);
  return contributorsMap;
};

export const fetchBitbucketContributorsForRepo = async (
  bitbucketServerInfo: BitbucketServerTarget,
  repo: Repo,
  contributorsMap: ContributorMap,
): Promise<void> => {
  const fullUrl = `${bitbucketServerInfo.url}/rest/api/1.0/projects/${repo.project.key}/repos/${repo.name}/commits`;

  try {
    debug(
      `Fetching single repo contributor from bitbucket-server. Project ${repo.project.key} - Repo ${repo.name}\n`,
    );

    // 7776000000 == 90 days in ms

    const response = (await fetchAllPages(
      fullUrl,
      bitbucketServerInfo.token,
      repo.name,
      isAnyCommitMoreThan90Days,
    )) as Commits[];

    const date: Date = new Date();
    let today = date.getTime();
    if (process.env.NODE_ENV == 'test') {
      today = date.setFullYear(2020, 6, 15);
    }
    for (let i = 0; i < response.length; i++) {
      const commit = response[i];
      // > is the right way, < is for testing really
      // todayDate - 90 days should be smaller than commit timestamp, otherwise timestamp occured before 90days
      if (today - 7776000000 > commit.authorTimestamp) {
        // Skipping if more than 90 days old
        continue;
      }
      let contributionsCount = 1;
      const visibility = repo.public ? 'Public' : 'Private';
      let reposContributedTo = [
        `${repo.project.name || repo.project.key}/${repo.name}(${visibility})`,
      ];

      if (contributorsMap && contributorsMap.has(commit.author.name)) {
        contributionsCount =
          contributorsMap.get(commit.author.name)?.contributionsCount || 0;
        contributionsCount++;

        reposContributedTo =
          contributorsMap.get(commit.author.name)?.reposContributedTo || [];
        if (
          !reposContributedTo.includes(
            `${repo.project.name || repo.project.key}/${
              repo.name
            }(${visibility})`,
          )
        ) {
          // Dedupping repo list here
          reposContributedTo.push(
            `${repo.project.name}/${repo.name}(${visibility})`,
          );
        }
      }
      if (
        !commit.author.emailAddress.endsWith('@users.noreply.github.com') &&
        commit.author.emailAddress != 'snyk-bot@snyk.io'
      ) {
        contributorsMap.set(commit.author.name, {
          email: commit.author.emailAddress,
          contributionsCount: contributionsCount,
          reposContributedTo: reposContributedTo,
        });
      }
    }
  } catch (err) {
    debug('Failed to retrieve commits from bitbucket-server.\n' + err);
    console.log(
      'Failed to retrieve commits from bitbucket-server. Try running with `DEBUG=snyk* snyk-contributor`',
    );
  }
};

export const fetchBitbucketReposForProjects = async (
  bitbucketServerInfo: BitbucketServerTarget,
): Promise<Repo[]> => {
  let repoList: Repo[] = [];

  const fullUrlSet: string[] = !bitbucketServerInfo.projectKeys
    ? [`${bitbucketServerInfo.url}/rest/api/1.0/repos`]
    : bitbucketServerInfo.projectKeys.map(
        (projectKey) =>
          `${bitbucketServerInfo.url}/rest/api/1.0/projects/${projectKey}/repos`,
      );

  try {
    for (let i = 0; i < fullUrlSet.length; i++) {
      debug(`Fetching repos list ${fullUrlSet[i]}\n`);
      repoList = repoList.concat(
        (await fetchAllPages(
          fullUrlSet[i],
          bitbucketServerInfo.token,
          'Projects',
        )) as Repo[],
      );
    }
    return repoList;
  } catch (err) {
    debug('Failed to retrieve repo list from bitbucket-server.\n' + err);
    console.log(
      'Failed to retrieve repo list from bitbucket-server. Try running with `DEBUG=snyk* snyk-contributor`',
    );
  }
  return repoList;
};
