import { ContentRef, DocumentTableViewCards, SiteInsightsLinkPosition } from '@gitbook/api';
import React from 'react';

import { Link } from '@/components/primitives';
import { Image } from '@/components/utils';
import { ClassValue, tcls } from '@/lib/tailwind';

import { RecordColumnValue } from './RecordColumnValue';
import { TableRecordKV, TableViewProps } from './Table';
import { getRecordValue } from './utils';

export async function RecordCard(
    props: TableViewProps<DocumentTableViewCards> & {
        record: TableRecordKV;
    },
) {
    const { view, record, context, block, isOffscreen } = props;

    const coverFile = view.coverDefinition
        ? getRecordValue<string[]>(record[1], view.coverDefinition)?.[0]
        : null;
    const cover = coverFile
        ? await context.resolveContentRef({ kind: 'file', file: coverFile })
        : null;

    const targetRef = view.targetDefinition
        ? (record[1].values[view.targetDefinition] as ContentRef)
        : null;
    const target = targetRef ? await context.resolveContentRef(targetRef) : null;

    const body = (
        <div
            className={tcls(
                'grid-area-1-1',
                'z-0',
                'relative',
                'grid',
                'bg-light-1',
                'dark:bg-dark-1',
                'w-[calc(100%+2px)]',
                'h-[calc(100%+2px)]',
                'inset-[-1px]',
                'rounded-[7px]',
                'straight-corners:rounded-none',
                'overflow-hidden',
                '[&_.heading]:flip-heading-hash',
                '[&_.blocks:first-child_.heading:first-child_div]:mt-0', // Remove margin on first heading in card

                cover
                    ? [
                          // On mobile, the cover is displayed on the left with 40% of the width
                          'grid-cols-[40%,_1fr]',
                          'min-[432px]:grid-cols-none',
                          'min-[432px]:grid-rows-[auto,1fr]',
                      ]
                    : null,
            )}
        >
            {cover ? (
                <Image
                    alt="Cover"
                    sources={{
                        light: {
                            src: cover.href,
                            size: cover.file?.dimensions,
                        },
                    }}
                    sizes={[
                        {
                            width: view.cardSize === 'medium' ? 245 : 376,
                        },
                    ]}
                    className={tcls(
                        'min-w-0',
                        'w-full',
                        'h-full',
                        'object-cover',
                        'min-[432px]:h-auto',
                        'min-[432px]:aspect-video',
                    )}
                    priority={isOffscreen ? 'lazy' : 'high'}
                    preload
                />
            ) : null}
            <div
                className={tcls(
                    'min-w-0',
                    'w-full',
                    'flex',
                    'flex-col',
                    'place-self-start',
                    'gap-3',
                    'p-4',
                    'text-sm',
                    target
                        ? [
                              'transition-colors',
                              'text-dark/8',
                              'dark:text-light/8',
                              'group-hover:text-dark/10',
                              'dark:group-hover:text-light/10',
                          ]
                        : ['text-dark/10', 'dark:text-light/10'],
                )}
            >
                {view.columns.map((column) => {
                    const definition = block.data.definition[column];

                    if (!definition) {
                        return null;
                    }

                    if (!view.hideColumnTitle && definition.title) {
                        const ariaLabelledBy = `${block.key}-${column}-title`;
                        return (
                            <div key={column} className="flex flex-col gap-1">
                                <div
                                    id={ariaLabelledBy}
                                    className="text-sm text-dark/8 dark:text-light/8"
                                >
                                    {definition.title}
                                </div>
                                <RecordColumnValue
                                    {...props}
                                    column={column}
                                    ariaLabelledBy={ariaLabelledBy}
                                />
                            </div>
                        );
                    }

                    return <RecordColumnValue key={column} {...props} column={column} />;
                })}
            </div>
        </div>
    );

    const style = [
        'group',
        'grid',
        'shadow-1xs',
        'shadow-dark/[0.02]',
        'rounded-md',
        'straight-corners:rounded-none',
        'dark:shadow-transparent',
        'z-0',
        'before:pointer-events-none',
        'before:grid-area-1-1',
        'before:transition-shadow',
        'before:w-full',
        'before:h-full',
        'before:rounded-[inherit]',
        'before:ring-1',
        'before:ring-dark/2',
        'before:z-10',
        'before:relative',
        'before:dark:ring-light/2',
    ] as ClassValue;

    if (target && targetRef) {
        return (
            <Link
                href={target.href}
                className={tcls(style, [
                    'hover:before:ring-dark/4',
                    'dark:hover:before:ring-light/4',
                ])}
                insights={{
                    target: targetRef,
                    position: SiteInsightsLinkPosition.Content,
                }}
            >
                {body}
            </Link>
        );
    }

    return <div className={tcls(style)}>{body}</div>;
}
