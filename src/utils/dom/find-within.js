export default function findWithin($context, selector) {
  return $context.find(`:scope :is(${selector})`).not($context);
}
