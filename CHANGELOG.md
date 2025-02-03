### 1.5

#### 1.5.1
- Implements WeakRef based reference to PubSub Subscriptions in MoopsyConnection to ease GC
- Includes some undocumented new features coming in 1.6 (PubSubTopicInterface and Coordinator). Use with caution.

#### 1.5.0

- Drop support for SocketIO and HTTP
    - All clients <1.4 will not be able to connect
    - Clients <1.4.8 may have connection issues if they switch from WS to HTTP
- Add timeouts to WriteableMoopsyStream, default of 60s
    - If timeout is exceeded, stream will automatically end
- Drop support for some events on _emitter
    - Stopped emitting `onSuccessfulSubscription`, now emitting `pubsub-subscription-created` from MoopsyServer
- Added new events on MoopsyServer
    - Added `pubsub-subscription-created`
    - Added `pubsub-subscription-deleted`
    - Added `connection-opened`
    - Added `connection-closed`
