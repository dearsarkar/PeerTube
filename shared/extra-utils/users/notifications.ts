/* eslint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { expect } from 'chai'
import { inspect } from 'util'
import { AbuseState, PluginType } from '@shared/models'
import { UserNotification, UserNotificationSetting, UserNotificationSettingValue, UserNotificationType } from '../../models/users'
import { MockSmtpServer } from '../mock-servers/mock-email'
import { PeerTubeServer } from '../server'
import { doubleFollow } from '../server/follows'
import { createMultipleServers } from '../server/servers'
import { setAccessTokensToServers } from './login'

function getAllNotificationsSettings (): UserNotificationSetting {
  return {
    newVideoFromSubscription: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    newCommentOnMyVideo: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    abuseAsModerator: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    videoAutoBlacklistAsModerator: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    blacklistOnMyVideo: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    myVideoImportFinished: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    myVideoPublished: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    commentMention: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    newFollow: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    newUserRegistration: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    newInstanceFollower: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    abuseNewMessage: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    abuseStateChange: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    autoInstanceFollowing: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    newPeerTubeVersion: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL,
    newPluginVersion: UserNotificationSettingValue.WEB | UserNotificationSettingValue.EMAIL
  }
}

type CheckerBaseParams = {
  server: PeerTubeServer
  emails: any[]
  socketNotifications: UserNotification[]
  token: string
  check?: { web: boolean, mail: boolean }
}

type CheckerType = 'presence' | 'absence'

async function checkNotification (
  base: CheckerBaseParams,
  notificationChecker: (notification: UserNotification, type: CheckerType) => void,
  emailNotificationFinder: (email: object) => boolean,
  checkType: CheckerType
) {
  const check = base.check || { web: true, mail: true }

  if (check.web) {
    const notification = await base.server.notifications.getLastest({ token: base.token })

    if (notification || checkType !== 'absence') {
      notificationChecker(notification, checkType)
    }

    const socketNotification = base.socketNotifications.find(n => {
      try {
        notificationChecker(n, 'presence')
        return true
      } catch {
        return false
      }
    })

    if (checkType === 'presence') {
      const obj = inspect(base.socketNotifications, { depth: 5 })
      expect(socketNotification, 'The socket notification is absent when it should be present. ' + obj).to.not.be.undefined
    } else {
      const obj = inspect(socketNotification, { depth: 5 })
      expect(socketNotification, 'The socket notification is present when it should not be present. ' + obj).to.be.undefined
    }
  }

  if (check.mail) {
    // Last email
    const email = base.emails
                      .slice()
                      .reverse()
                      .find(e => emailNotificationFinder(e))

    if (checkType === 'presence') {
      const emails = base.emails.map(e => e.text)
      expect(email, 'The email is absent when is should be present. ' + inspect(emails)).to.not.be.undefined
    } else {
      expect(email, 'The email is present when is should not be present. ' + inspect(email)).to.be.undefined
    }
  }
}

function checkVideo (video: any, videoName?: string, videoUUID?: string) {
  if (videoName) {
    expect(video.name).to.be.a('string')
    expect(video.name).to.not.be.empty
    expect(video.name).to.equal(videoName)
  }

  if (videoUUID) {
    expect(video.uuid).to.be.a('string')
    expect(video.uuid).to.not.be.empty
    expect(video.uuid).to.equal(videoUUID)
  }

  expect(video.id).to.be.a('number')
}

function checkActor (actor: any) {
  expect(actor.displayName).to.be.a('string')
  expect(actor.displayName).to.not.be.empty
  expect(actor.host).to.not.be.undefined
}

function checkComment (comment: any, commentId: number, threadId: number) {
  expect(comment.id).to.equal(commentId)
  expect(comment.threadId).to.equal(threadId)
}

async function checkNewVideoFromSubscription (base: CheckerBaseParams, videoName: string, videoUUID: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_VIDEO_FROM_SUBSCRIPTION

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkVideo(notification.video, videoName, videoUUID)
      checkActor(notification.video.channel)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.type !== UserNotificationType.NEW_VIDEO_FROM_SUBSCRIPTION || n.video.name !== videoName
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    return text.indexOf(videoUUID) !== -1 && text.indexOf('Your subscription') !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkVideoIsPublished (base: CheckerBaseParams, videoName: string, videoUUID: string, type: CheckerType) {
  const notificationType = UserNotificationType.MY_VIDEO_PUBLISHED

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkVideo(notification.video, videoName, videoUUID)
      checkActor(notification.video.channel)
    } else {
      expect(notification.video).to.satisfy(v => v === undefined || v.name !== videoName)
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']
    return text.includes(videoUUID) && text.includes('Your video')
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkMyVideoImportIsFinished (
  base: CheckerBaseParams,
  videoName: string,
  videoUUID: string,
  url: string,
  success: boolean,
  type: CheckerType
) {
  const notificationType = success ? UserNotificationType.MY_VIDEO_IMPORT_SUCCESS : UserNotificationType.MY_VIDEO_IMPORT_ERROR

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.videoImport.targetUrl).to.equal(url)

      if (success) checkVideo(notification.videoImport.video, videoName, videoUUID)
    } else {
      expect(notification.videoImport).to.satisfy(i => i === undefined || i.targetUrl !== url)
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']
    const toFind = success ? ' finished' : ' error'

    return text.includes(url) && text.includes(toFind)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkUserRegistered (base: CheckerBaseParams, username: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_USER_REGISTRATION

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkActor(notification.account)
      expect(notification.account.name).to.equal(username)
    } else {
      expect(notification).to.satisfy(n => n.type !== notificationType || n.account.name !== username)
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']

    return text.includes(' registered.') && text.includes(username)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewActorFollow (
  base: CheckerBaseParams,
  followType: 'channel' | 'account',
  followerName: string,
  followerDisplayName: string,
  followingDisplayName: string,
  type: CheckerType
) {
  const notificationType = UserNotificationType.NEW_FOLLOW

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkActor(notification.actorFollow.follower)
      expect(notification.actorFollow.follower.displayName).to.equal(followerDisplayName)
      expect(notification.actorFollow.follower.name).to.equal(followerName)
      expect(notification.actorFollow.follower.host).to.not.be.undefined

      const following = notification.actorFollow.following
      expect(following.displayName).to.equal(followingDisplayName)
      expect(following.type).to.equal(followType)
    } else {
      expect(notification).to.satisfy(n => {
        return n.type !== notificationType ||
          (n.actorFollow.follower.name !== followerName && n.actorFollow.following !== followingDisplayName)
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']

    return text.includes(followType) && text.includes(followingDisplayName) && text.includes(followerDisplayName)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewInstanceFollower (base: CheckerBaseParams, followerHost: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_INSTANCE_FOLLOWER

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkActor(notification.actorFollow.follower)
      expect(notification.actorFollow.follower.name).to.equal('peertube')
      expect(notification.actorFollow.follower.host).to.equal(followerHost)

      expect(notification.actorFollow.following.name).to.equal('peertube')
    } else {
      expect(notification).to.satisfy(n => {
        return n.type !== notificationType || n.actorFollow.follower.host !== followerHost
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']

    return text.includes('instance has a new follower') && text.includes(followerHost)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkAutoInstanceFollowing (base: CheckerBaseParams, followerHost: string, followingHost: string, type: CheckerType) {
  const notificationType = UserNotificationType.AUTO_INSTANCE_FOLLOWING

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      const following = notification.actorFollow.following
      checkActor(following)
      expect(following.name).to.equal('peertube')
      expect(following.host).to.equal(followingHost)

      expect(notification.actorFollow.follower.name).to.equal('peertube')
      expect(notification.actorFollow.follower.host).to.equal(followerHost)
    } else {
      expect(notification).to.satisfy(n => {
        return n.type !== notificationType || n.actorFollow.following.host !== followingHost
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']

    return text.includes(' automatically followed a new instance') && text.includes(followingHost)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkCommentMention (
  base: CheckerBaseParams,
  uuid: string,
  commentId: number,
  threadId: number,
  byAccountDisplayName: string,
  type: CheckerType
) {
  const notificationType = UserNotificationType.COMMENT_MENTION

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkComment(notification.comment, commentId, threadId)
      checkActor(notification.comment.account)
      expect(notification.comment.account.displayName).to.equal(byAccountDisplayName)

      checkVideo(notification.comment.video, undefined, uuid)
    } else {
      expect(notification).to.satisfy(n => n.type !== notificationType || n.comment.id !== commentId)
    }
  }

  function emailNotificationFinder (email: object) {
    const text: string = email['text']

    return text.includes(' mentioned ') && text.includes(uuid) && text.includes(byAccountDisplayName)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

let lastEmailCount = 0

async function checkNewCommentOnMyVideo (base: CheckerBaseParams, uuid: string, commentId: number, threadId: number, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_COMMENT_ON_MY_VIDEO

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      checkComment(notification.comment, commentId, threadId)
      checkActor(notification.comment.account)
      checkVideo(notification.comment.video, undefined, uuid)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.comment === undefined || n.comment.id !== commentId
      })
    }
  }

  const commentUrl = `http://localhost:${base.server.port}/w/${uuid};threadId=${threadId}`

  function emailNotificationFinder (email: object) {
    return email['text'].indexOf(commentUrl) !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)

  if (type === 'presence') {
    // We cannot detect email duplicates, so check we received another email
    expect(base.emails).to.have.length.above(lastEmailCount)
    lastEmailCount = base.emails.length
  }
}

async function checkNewVideoAbuseForModerators (base: CheckerBaseParams, videoUUID: string, videoName: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_ABUSE_FOR_MODERATORS

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.abuse.id).to.be.a('number')
      checkVideo(notification.abuse.video, videoName, videoUUID)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.abuse === undefined || n.abuse.video.uuid !== videoUUID
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    return text.indexOf(videoUUID) !== -1 && text.indexOf('abuse') !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewAbuseMessage (base: CheckerBaseParams, abuseId: number, message: string, toEmail: string, type: CheckerType) {
  const notificationType = UserNotificationType.ABUSE_NEW_MESSAGE

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.abuse.id).to.equal(abuseId)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.type !== notificationType || n.abuse === undefined || n.abuse.id !== abuseId
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    const to = email['to'].filter(t => t.address === toEmail)

    return text.indexOf(message) !== -1 && to.length !== 0
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkAbuseStateChange (base: CheckerBaseParams, abuseId: number, state: AbuseState, type: CheckerType) {
  const notificationType = UserNotificationType.ABUSE_STATE_CHANGE

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.abuse.id).to.equal(abuseId)
      expect(notification.abuse.state).to.equal(state)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.abuse === undefined || n.abuse.id !== abuseId
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']

    const contains = state === AbuseState.ACCEPTED
      ? ' accepted'
      : ' rejected'

    return text.indexOf(contains) !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewCommentAbuseForModerators (base: CheckerBaseParams, videoUUID: string, videoName: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_ABUSE_FOR_MODERATORS

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.abuse.id).to.be.a('number')
      checkVideo(notification.abuse.comment.video, videoName, videoUUID)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.abuse === undefined || n.abuse.comment.video.uuid !== videoUUID
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    return text.indexOf(videoUUID) !== -1 && text.indexOf('abuse') !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewAccountAbuseForModerators (base: CheckerBaseParams, displayName: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_ABUSE_FOR_MODERATORS

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.abuse.id).to.be.a('number')
      expect(notification.abuse.account.displayName).to.equal(displayName)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.abuse === undefined || n.abuse.account.displayName !== displayName
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    return text.indexOf(displayName) !== -1 && text.indexOf('abuse') !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkVideoAutoBlacklistForModerators (base: CheckerBaseParams, videoUUID: string, videoName: string, type: CheckerType) {
  const notificationType = UserNotificationType.VIDEO_AUTO_BLACKLIST_FOR_MODERATORS

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.videoBlacklist.video.id).to.be.a('number')
      checkVideo(notification.videoBlacklist.video, videoName, videoUUID)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.video === undefined || n.video.uuid !== videoUUID
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    return text.indexOf(videoUUID) !== -1 && email['text'].indexOf('video-auto-blacklist/list') !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewBlacklistOnMyVideo (
  base: CheckerBaseParams,
  videoUUID: string,
  videoName: string,
  blacklistType: 'blacklist' | 'unblacklist'
) {
  const notificationType = blacklistType === 'blacklist'
    ? UserNotificationType.BLACKLIST_ON_MY_VIDEO
    : UserNotificationType.UNBLACKLIST_ON_MY_VIDEO

  function notificationChecker (notification: UserNotification) {
    expect(notification).to.not.be.undefined
    expect(notification.type).to.equal(notificationType)

    const video = blacklistType === 'blacklist' ? notification.videoBlacklist.video : notification.video

    checkVideo(video, videoName, videoUUID)
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']
    return text.indexOf(videoUUID) !== -1 && text.indexOf(' ' + blacklistType) !== -1
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, 'presence')
}

async function checkNewPeerTubeVersion (base: CheckerBaseParams, latestVersion: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_PEERTUBE_VERSION

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.peertube).to.exist
      expect(notification.peertube.latestVersion).to.equal(latestVersion)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.peertube === undefined || n.peertube.latestVersion !== latestVersion
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']

    return text.includes(latestVersion)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function checkNewPluginVersion (base: CheckerBaseParams, pluginType: PluginType, pluginName: string, type: CheckerType) {
  const notificationType = UserNotificationType.NEW_PLUGIN_VERSION

  function notificationChecker (notification: UserNotification, type: CheckerType) {
    if (type === 'presence') {
      expect(notification).to.not.be.undefined
      expect(notification.type).to.equal(notificationType)

      expect(notification.plugin.name).to.equal(pluginName)
      expect(notification.plugin.type).to.equal(pluginType)
    } else {
      expect(notification).to.satisfy((n: UserNotification) => {
        return n === undefined || n.plugin === undefined || n.plugin.name !== pluginName
      })
    }
  }

  function emailNotificationFinder (email: object) {
    const text = email['text']

    return text.includes(pluginName)
  }

  await checkNotification(base, notificationChecker, emailNotificationFinder, type)
}

async function prepareNotificationsTest (serversCount = 3, overrideConfigArg: any = {}) {
  const userNotifications: UserNotification[] = []
  const adminNotifications: UserNotification[] = []
  const adminNotificationsServer2: UserNotification[] = []
  const emails: object[] = []

  const port = await MockSmtpServer.Instance.collectEmails(emails)

  const overrideConfig = {
    smtp: {
      hostname: 'localhost',
      port
    },
    signup: {
      limit: 20
    }
  }
  const servers = await createMultipleServers(serversCount, Object.assign(overrideConfig, overrideConfigArg))

  await setAccessTokensToServers(servers)

  if (serversCount > 1) {
    await doubleFollow(servers[0], servers[1])
  }

  const user = { username: 'user_1', password: 'super password' }
  await servers[0].users.create({ ...user, videoQuota: 10 * 1000 * 1000 })
  const userAccessToken = await servers[0].login.getAccessToken(user)

  await servers[0].notifications.updateMySettings({ token: userAccessToken, settings: getAllNotificationsSettings() })
  await servers[0].notifications.updateMySettings({ settings: getAllNotificationsSettings() })

  if (serversCount > 1) {
    await servers[1].notifications.updateMySettings({ settings: getAllNotificationsSettings() })
  }

  {
    const socket = servers[0].socketIO.getUserNotificationSocket({ token: userAccessToken })
    socket.on('new-notification', n => userNotifications.push(n))
  }
  {
    const socket = servers[0].socketIO.getUserNotificationSocket()
    socket.on('new-notification', n => adminNotifications.push(n))
  }

  if (serversCount > 1) {
    const socket = servers[1].socketIO.getUserNotificationSocket()
    socket.on('new-notification', n => adminNotificationsServer2.push(n))
  }

  const { videoChannels } = await servers[0].users.getMyInfo()
  const channelId = videoChannels[0].id

  return {
    userNotifications,
    adminNotifications,
    adminNotificationsServer2,
    userAccessToken,
    emails,
    servers,
    channelId
  }
}

// ---------------------------------------------------------------------------

export {
  getAllNotificationsSettings,

  CheckerBaseParams,
  CheckerType,
  checkNotification,
  checkMyVideoImportIsFinished,
  checkUserRegistered,
  checkAutoInstanceFollowing,
  checkVideoIsPublished,
  checkNewVideoFromSubscription,
  checkNewActorFollow,
  checkNewCommentOnMyVideo,
  checkNewBlacklistOnMyVideo,
  checkCommentMention,
  checkNewVideoAbuseForModerators,
  checkVideoAutoBlacklistForModerators,
  checkNewAbuseMessage,
  checkAbuseStateChange,
  checkNewInstanceFollower,
  prepareNotificationsTest,
  checkNewCommentAbuseForModerators,
  checkNewAccountAbuseForModerators,
  checkNewPeerTubeVersion,
  checkNewPluginVersion
}
