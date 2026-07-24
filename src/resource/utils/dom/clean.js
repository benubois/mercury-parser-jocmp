import { TAGS_TO_REMOVE } from './constants';

function pushChildren(stack, children) {
  for (let index = 0; index < children.length; index += 1) {
    stack.push(children[index]);
  }
}

function cleanComments($) {
  const root = $.root().get(0);
  const stack = [];
  const comments = [];

  if (root && root.children) {
    pushChildren(stack, root.children);
  }

  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === 'comment') {
      comments.push(node);
    } else if (node.children) {
      pushChildren(stack, node.children);
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
