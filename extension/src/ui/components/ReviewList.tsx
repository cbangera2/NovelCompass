import type { LiveReview, LiveReviewPage } from '../../adapters/contracts';
import type { SeriesSectionState } from '../ExtensionSeriesApp';

export interface ReviewListProps {
  state: SeriesSectionState<LiveReviewPage>;
  onInvokeAction: (actionId: string) => void;
}

export function ReviewList({ state, onInvokeAction }: ReviewListProps): JSX.Element {
  if (state.status === 'loading') {
    return <SectionStatus message="Loading Novel Updates reviews…" />;
  }
  if (state.status === 'unavailable') {
    return (
      <SectionStatus
        alert
        message={state.message ?? 'Reviews are unavailable in the redesigned view.'}
      />
    );
  }

  const page = state.data;
  return (
    <section className="series-section-card" aria-labelledby="reviews-heading">
      <header className="series-section-heading">
        <div>
          <p className="series-eyebrow">Reader perspectives</p>
          <h2 id="reviews-heading">Reviews</h2>
        </div>
        {page.total !== undefined ? <span>{page.total} total</span> : null}
      </header>
      {page.loginRequired ? (
        <p className="series-inline-notice">
          Log in through Novel Updates to write or interact with reviews.
        </p>
      ) : null}
      {page.rows.length ? (
        <div className="review-list">
          {page.rows.map((review, index) => (
            <ReviewCard
              key={review.permalink ?? `${review.reviewer.label}-${index}`}
              review={review}
              onInvokeAction={onInvokeAction}
            />
          ))}
        </div>
      ) : (
        <div className="series-empty-state">
          <h3>No reviews yet</h3>
          <p>Be the first to share a thoughtful review on Novel Updates.</p>
        </div>
      )}
    </section>
  );
}

function ReviewCard({
  review,
  onInvokeAction,
}: {
  review: LiveReview;
  onInvokeAction: (actionId: string) => void;
}): JSX.Element {
  return (
    <article className="review-card">
      <header>
        <div>
          <strong>{review.reviewer.label}</strong>
          <span>{review.postedAtLabel}</span>
        </div>
        {review.rating !== undefined ? (
          <span aria-label={`${review.rating} out of 5 stars`}>{review.rating.toFixed(1)} ★</span>
        ) : null}
      </header>
      {review.progressLabel ? <p className="review-progress">{review.progressLabel}</p> : null}
      <div className="review-body">
        {review.body.map((block, index) => {
          if (block.type === 'quote') {
            return <blockquote key={index}>{block.text}</blockquote>;
          }
          if (block.type === 'list') {
            return (
              <ul key={index}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          }
          return <p key={index}>{block.text}</p>;
        })}
      </div>
      <footer>
        {review.likeCount !== undefined ? <span>{review.likeCount} likes</span> : null}
        {review.actionIds.expand ? (
          <ActionButton
            actionId={review.actionIds.expand}
            label={review.isTruncated ? 'Show more' : 'Collapse'}
            onInvokeAction={onInvokeAction}
          />
        ) : null}
        {review.actionIds.like ? (
          <ActionButton
            actionId={review.actionIds.like}
            label="Like"
            onInvokeAction={onInvokeAction}
          />
        ) : null}
        {review.actionIds.report ? (
          <ActionButton
            actionId={review.actionIds.report}
            label="Report"
            onInvokeAction={onInvokeAction}
          />
        ) : null}
      </footer>
    </article>
  );
}

function ActionButton({
  actionId,
  label,
  onInvokeAction,
}: {
  actionId: string;
  label: string;
  onInvokeAction: (actionId: string) => void;
}): JSX.Element {
  return (
    <button onClick={() => onInvokeAction(actionId)} type="button">
      {label}
    </button>
  );
}

function SectionStatus({
  alert = false,
  message,
}: {
  alert?: boolean;
  message: string;
}): JSX.Element {
  return (
    <div className="series-section-status" role={alert ? 'alert' : 'status'} aria-live="polite">
      <p>{message}</p>
      <small>The original-view control remains available in the page corner.</small>
    </div>
  );
}
