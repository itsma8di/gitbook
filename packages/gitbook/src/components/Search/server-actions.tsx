'use server';

import { RevisionPage, SearchAIAnswer, SearchPageResult, SiteSpace, Space } from '@gitbook/api';
import pMap from 'p-map';
import * as React from 'react';
import { assert } from 'ts-essentials';

import { streamResponse } from '@/lib/actions';
import * as api from '@/lib/api';
import { absoluteHref, pageHref } from '@/lib/links';
import { resolvePageId } from '@/lib/pages';
import { filterOutNullable } from '@/lib/typescript';

import { DocumentView } from '../DocumentView';

export type OrderedComputedResult = ComputedPageResult | ComputedSectionResult;

export interface ComputedSectionResult {
    type: 'section';
    id: string;
    title: string;
    href: string;
    body: string;
}

export interface ComputedPageResult {
    type: 'page';
    id: string;
    title: string;
    href: string;

    /** When part of a multi-spaces search, the title of the space */
    spaceTitle?: string;
}

export interface AskAnswerSource {
    id: string;
    title: string;
    href: string;
}

export interface AskAnswerResult {
    /** Undefined if no answer. */
    body?: React.ReactNode;
    followupQuestions: string[];
    sources: AskAnswerSource[];
}

/**
 * Search for content in a site by scoping the search to all content, a specific spaces or current space.
 */
async function searchSiteContent(args: {
    pointer: api.SiteContentPointer;
    query: string;
    scope:
        | { mode: 'all' }
        | { mode: 'current'; siteSpaceId: string }
        | { mode: 'specific'; siteSpaceIds: string[] };
    cacheBust?: string;
}): Promise<OrderedComputedResult[]> {
    const { pointer, scope, query, cacheBust } = args;

    if (query.length <= 1) {
        return [];
    }

    const needsStructure =
        scope.mode === 'all' ||
        scope.mode === 'current' ||
        (scope.mode === 'specific' && scope.siteSpaceIds.length > 1);

    const [searchResults, siteData] = await Promise.all([
        api.searchSiteContent(pointer.organizationId, pointer.siteId, query, scope, cacheBust),
        needsStructure ? api.getSiteData(pointer) : null,
    ]);
    const siteStructure = siteData?.structure;

    const siteSpaces = siteStructure
        ? siteStructure.type === 'siteSpaces'
            ? siteStructure.structure
            : siteStructure.structure.reduce<SiteSpace[]>((prev, section) => {
                  const sectionSiteSpaces = section.siteSpaces.map((siteSpace) => ({
                      ...siteSpace,
                      space: {
                          ...siteSpace.space,
                          title: section.title || siteSpace.space.title,
                      },
                  }));

                  prev.push(...sectionSiteSpaces);
                  return prev;
              }, [])
        : null;

    if (siteSpaces) {
        // We are searching all of this Site's content
        return searchResults.items
            .map((spaceItem) => {
                const siteSpace = siteSpaces.find(
                    (siteSpace) => siteSpace.space.id === spaceItem.id,
                );

                return spaceItem.pages.map((item) => transformSitePageResult(item, siteSpace));
            })
            .flat(2);
    }

    return searchResults.items
        .map((spaceItem) => {
            return spaceItem.pages.map((item) => transformPageResult(item));
        })
        .flat(2);
}

/**
 * Server action to search content in the entire site.
 */
export async function searchAllSiteContent(
    query: string,
    pointer: api.SiteContentPointer,
): Promise<OrderedComputedResult[]> {
    return await searchSiteContent({
        pointer,
        query,
        scope: { mode: 'all' },
    });
}

/**
 * Server action to search content in a space.
 */
export async function searchSiteSpaceContent(
    query: string,
    pointer: api.SiteContentPointer,
    revisionId: string,
): Promise<OrderedComputedResult[]> {
    const siteSpaceId = pointer.siteSpaceId;
    assert(siteSpaceId, 'Expected siteSpaceId for searchSiteSpaceContent');

    return await searchSiteContent({
        pointer,
        query,
        // If we have a siteSectionId that means its a sections site use `current` mode
        // which searches in the current space + all default spaces of sections
        scope: pointer.siteSectionId
            ? { mode: 'current', siteSpaceId }
            : { mode: 'specific', siteSpaceIds: [siteSpaceId] },
        // We want to break cache for this specific space if the revisionId is different so use it as a cache busting key
        cacheBust: revisionId,
    });
}

/**
 * Server action to ask a question in a space.
 */
export const streamAskQuestion = streamResponse(async function* (
    organizationId: string,
    siteId: string,
    siteSpaceId: string | null,
    question: string,
) {
    const stream = api.api().orgs.streamAskInSite(
        organizationId,
        siteId,
        {
            question,
            context: siteSpaceId
                ? {
                      siteSpaceId,
                  }
                : undefined,
            scope: {
                mode: 'default',

                // Include the current site space regardless.
                includedSiteSpaces: siteSpaceId ? [siteSpaceId] : undefined,
            },
        },
        { format: 'document' },
    );

    const spaceData = new Map<string, RevisionPage[]>();
    for await (const chunk of stream) {
        if (!chunk) {
            continue;
        }

        const encoded = await transformAnswer(chunk.answer, spaceData);
        yield encoded;
    }
});

/**
 * List suggested questions for a space.
 */
export async function getRecommendedQuestions(spaceId: string): Promise<string[]> {
    const data = await api.getRecommendedQuestionsInSpace(spaceId);
    return data.questions;
}

async function transformAnswer(
    answer: SearchAIAnswer,

    /**
     * Transforming an answer requires fetching space data so we can calculate absolute
     * and relative page paths. Maintain an in-memory cache of space data to avoid
     * refetching for the same source.
     */
    spaceData: Map<string, RevisionPage[]>,
): Promise<AskAnswerResult> {
    // Gather a unique set of all space IDs referenced in this answer.
    const spaces = answer.sources.reduce<Set<string>>((set, source) => {
        if (source.type !== 'page') {
            return set;
        }

        return set.add(source.space);
    }, new Set<string>());

    // Fetch the content of all spaces referenced in this answer, if not already fetched.
    await pMap(
        spaces.values(),
        async (spaceId) => {
            if (spaceData.has(spaceId)) {
                return;
            }

            const { pages } = await api.getSpaceContentData({ spaceId }, undefined);
            spaceData.set(spaceId, pages);
        },
        { concurrency: 1 },
    );

    const sources = answer.sources
        .map((source) => {
            if (source.type !== 'page') {
                return null;
            }

            const pages = spaceData.get(source.space);

            if (!pages) {
                return null;
            }

            const page = resolvePageId(pages, source.page);
            if (!page) {
                return null;
            }

            return {
                id: source.page,
                title: page.page.title,
                href: pageHref(pages, page.page),
            };
        })
        .filter(filterOutNullable);

    return {
        body:
            answer.answer && 'document' in answer.answer ? (
                <DocumentView
                    document={answer.answer.document}
                    context={{
                        mode: 'default',
                        contentRefContext: null,
                        resolveContentRef: async () => null,
                        wrapBlocksInSuspense: false,
                    }}
                    style={['space-y-5']}
                />
            ) : null,
        followupQuestions: answer.followupQuestions,
        sources,
    };
}

function transformSectionsAndPage(args: {
    item: SearchPageResult;
    space?: Space;
    spaceURL?: string;
}): [ComputedPageResult, ComputedSectionResult[]] {
    const { item, space, spaceURL } = args;

    // Resolve a relative path to an absolute URL
    // if the search result is relative to another space, we use the space URL
    const getURL = (path: string, spaceURL?: string) => {
        if (spaceURL) {
            if (!spaceURL.endsWith('/')) {
                spaceURL += '/';
            }
            if (path.startsWith('/')) {
                path = path.slice(1);
            }
            return spaceURL + path;
        } else {
            return absoluteHref(path);
        }
    };

    const sections =
        item.sections?.map<ComputedSectionResult>((section) => ({
            type: 'section',
            id: item.id + '/' + section.id,
            title: section.title,
            href: getURL(section.path, spaceURL),
            body: section.body,
        })) ?? [];

    const page: ComputedPageResult = {
        type: 'page',
        id: item.id,
        title: item.title,
        href: getURL(item.path, spaceURL),
        spaceTitle: space?.title,
    };

    return [page, sections];
}

function transformSitePageResult(item: SearchPageResult, siteSpace?: SiteSpace) {
    const [page, sections] = transformSectionsAndPage({
        item,
        space: siteSpace?.space,
        spaceURL: siteSpace?.urls.published,
    });

    return [page, ...sections];
}

function transformPageResult(item: SearchPageResult, space?: Space) {
    const [page, sections] = transformSectionsAndPage({
        item,
        space,
        spaceURL: space?.urls.published ?? space?.urls.app,
    });

    return [page, ...sections];
}
