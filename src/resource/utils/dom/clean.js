import { TAGS_TO_REMOVE } from './constants';

function cleanComments($) {
  const root = $.root().get(0);
  const stack = root && root.children ? [...root.children] : [];
  const comments = [];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === 'comment') {
      comments.push(node);
    } else if (node.children) {
      stack.push(...node.children);
    }
  }

  $(comments).remove();

  return $;
}

export default function clean($) {
  $(TAGS_TO_REMOVE).remove();

  $ = cleanComments($);
  return $;
}
