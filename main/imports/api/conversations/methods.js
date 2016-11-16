import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { _ } from 'meteor/underscore';
import { ValidatedMethod } from 'meteor/mdg:validated-method';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';

import { ErxesMixin } from '/imports/api/utils';
import { Conversations } from './conversations';
import { CONVERSATION_STATUSES } from './constants';
import { Messages, FormSchema } from './messages';

if (Meteor.isServer) {
  import { sendNotification } from '/imports/api/server/utils';
}

// all possible users they can get notifications
const conversationNotifReceivers = (conversation, currentUserId) => {
  let userIds = [];

  // assigned user can get notifications
  if (conversation.assignedUserId) {
    userIds.push(conversation.assignedUserId);
  }

  // participated users can get notifications
  if (conversation.participatedUserIds) {
    userIds = _.union(userIds, conversation.participatedUserIds);
  }

  // exclude current user
  userIds = _.without(userIds, currentUserId);

  return userIds;
};


export const addMessage = new ValidatedMethod({
  name: 'conversations.addMessage',
  mixins: [ErxesMixin],
  validate: FormSchema.validator(),

  run(_doc) {
    const doc = _doc;
    const conversation = Conversations.findOne(doc.conversationId);

    if (!conversation) {
      throw new Meteor.Error(
        'conversations.addMessage.conversationNotFound',
        'Conversation not found'
      );
    }

    // normalize content, attachments
    const content = doc.content || '';
    const attachments = doc.attachments || [];

    doc.content = content;
    doc.attachments = attachments;

    // if there is not attachments and no content then throw content required
    // error
    if (attachments.length === 0 && !content.trim()) {
      throw new Meteor.Error(
        'conversations.addMessage.contentRequired',
        'Content is required'
      );
    }

    // send notification
    if (Meteor.isServer) {
      const messageedUser = Meteor.users.findOne({ _id: this.userId });
      const title = `${messageedUser.details.fullName} messageed on a conversation`;

      sendNotification({
        createdUser: this.userId,
        notifType: 'conversationAddMessage',
        title,
        content: title,
        link: `/inbox/details/${conversation._id}`,
        receivers: conversationNotifReceivers(conversation, this.userId),
      });
    }

    return Messages.insert(_.extend({ userId: this.userId }, doc));
  },
});


export const assign = new ValidatedMethod({
  name: 'conversations.assign',
  mixins: [ErxesMixin],

  validate: new SimpleSchema({
    conversationIds: {
      type: [String],
      regEx: SimpleSchema.RegEx.Id,
    },

    assignedUserId: {
      type: String,
      regEx: SimpleSchema.RegEx.Id,
    },
  }).validator(),

  run({ conversationIds, assignedUserId }) {
    const conversations = Conversations.find({ _id: { $in: conversationIds } }).fetch();

    if (conversations.length !== conversationIds.length) {
      throw new Meteor.Error(
        'conversations.assign.conversationNotFound',
        'Conversation not found.'
      );
    }

    if (Meteor.isServer && !Meteor.users.findOne(assignedUserId)) {
      throw new Meteor.Error(
        'conversations.assign.userNotFound',
        'User not found.'
      );
    }

    Conversations.update(
      { _id: { $in: conversationIds } },
      { $set: { assignedUserId } },
      { multi: true }
    );

    if (Meteor.isServer) {
      const updatedConversations = Conversations.find({ _id: { $in: conversationIds } }).fetch();

      // send notification
      _.each(updatedConversations, (conversation) => {
        const assignedUser = Meteor.users.findOne({ _id: assignedUserId });
        const content = `Conversation's assigned person changed to ${assignedUser.details.fullName}`;

        sendNotification({
          createdUser: this.userId,
          notifType: 'conversationAssigneeChange',
          title: content,
          content,
          link: `/inbox/details/${conversation._id}`,
          receivers: conversationNotifReceivers(conversation, this.userId),
        });
      });
    }
  },
});


export const unassign = new ValidatedMethod({
  name: 'conversations.unassign',
  mixins: [ErxesMixin],

  validate: new SimpleSchema({
    conversationIds: {
      type: [String],
      regEx: SimpleSchema.RegEx.Id,
    },
  }).validator(),

  run({ conversationIds }) {
    const conversations = Conversations.find({ _id: { $in: conversationIds } }).fetch();

    if (conversations.length !== conversationIds.length) {
      throw new Meteor.Error(
        'conversations.unassign.conversationNotFound',
        'Conversation not found.'
      );
    }

    Conversations.update(
      { _id: { $in: conversationIds } },
      { $unset: { assignedUserId: 1 } },
      { multi: true }
    );
  },
});


export const changeStatus = new ValidatedMethod({
  name: 'conversations.changeStatus',
  mixins: [ErxesMixin],

  validate: new SimpleSchema({
    conversationIds: {
      type: [String],
      regEx: SimpleSchema.RegEx.Id,
    },
    status: {
      type: String,
      allowedValues: CONVERSATION_STATUSES.ALL_LIST,
    },
  }).validator(),

  run({ conversationIds, status }) {
    const conversations = Conversations.find({ _id: { $in: conversationIds } }).fetch();

    if (conversations.length !== conversationIds.length) {
      throw new Meteor.Error(
        'conversations.changeStatus.conversationNotFound',
        'Conversation not found.'
      );
    }

    Conversations.update(
      { _id: { $in: conversationIds } },
      { $set: { status } },
      { multi: true }
    );

    // send notification
    if (Meteor.isServer) {
      _.each(conversations, (conversation) => {
        const content = `Conversation's status changed to ${status}`;

        sendNotification({
          createdUser: this.userId,
          notifType: 'conversationStateChange',
          title: content,
          content,
          link: `/inbox/details/${conversation._id}`,
          receivers: conversationNotifReceivers(conversation, this.userId),
        });
      });
    }
  },
});


export const star = new ValidatedMethod({
  name: 'conversations.star',
  mixins: [ErxesMixin],

  validate: new SimpleSchema({
    conversationIds: {
      type: [String],
      regEx: SimpleSchema.RegEx.Id,
    },
  }).validator(),

  run({ conversationIds }) {
    const conversations = Conversations.find({ _id: { $in: conversationIds } }).fetch();

    if (conversations.length !== conversationIds.length) {
      throw new Meteor.Error(
        'conversations.star.conversationNotFound',
        'Conversation not found.'
      );
    }

    Meteor.users.update(
      this.userId,
      { $addToSet: { 'details.starredConversationIds': { $each: conversationIds } } }
    );
  },
});


export const unstar = new ValidatedMethod({
  name: 'conversations.unstar',
  mixins: [ErxesMixin],

  validate: new SimpleSchema({
    conversationIds: {
      type: [String],
      regEx: SimpleSchema.RegEx.Id,
    },
  }).validator(),

  run({ conversationIds }) {
    if (Meteor.isServer) {
      Meteor.users.update(
        this.userId,
        { $pull: { 'details.starredConversationIds': { $in: conversationIds } } }
      );
    } else {
      Meteor.users.update(
        this.userId,
        { $pull: { 'details.starredConversationIds': conversationIds } }
      );
    }
  },
});


// mark given conversation as read for current user
export const markAsRead = new ValidatedMethod({
  name: 'conversations.markAsRead',
  mixins: [ErxesMixin],

  validate({ conversationId }) {
    check(conversationId, String);
  },

  run({ conversationId }) {
    const conversation = Conversations.findOne({ _id: conversationId });

    if (conversation) {
      const readUserIds = conversation.readUserIds;

      // if current user is first one
      if (!readUserIds) {
        return Conversations.update(
          { _id: conversationId },
          { $set: { readUserIds: [this.userId] } }
        );
      }

      // if current user is not in read users list then add it
      if (!readUserIds.includes(this.userId)) {
        return Conversations.update(
          { _id: conversationId },
          { $push: { readUserIds: this.userId } }
        );
      }
    }

    return 'not affected';
  },
});
