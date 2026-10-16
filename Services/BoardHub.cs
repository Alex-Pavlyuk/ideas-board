using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;

namespace IdeasBoard.Services;

/// <summary>
/// Fan-out for board changes over Server-Sent Events.
///
/// SSE rather than SignalR: the traffic is one-directional (server → board),
/// a handful of small JSON frames per minute, and it needs no client library,
/// no negotiate round-trip and no WebSocket upgrade through the router.
/// </summary>
public sealed class BoardHub
{
    private sealed record Subscriber(long UserId, Channel<string> Channel);

    private readonly ConcurrentDictionary<Guid, Subscriber> _subscribers = new();

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public int SubscriberCount => _subscribers.Count;

    public IEnumerable<long> OnlineUserIds => _subscribers.Values.Select(s => s.UserId).Distinct();

    public (Guid Id, ChannelReader<string> Reader) Subscribe(long userId)
    {
        // Bounded + DropOldest: a stalled reader must never grow the server's
        // heap. A client that misses frames reconnects and refetches the board.
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(64)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });
        var id = Guid.NewGuid();
        _subscribers[id] = new Subscriber(userId, channel);
        return (id, channel.Reader);
    }

    public void Unsubscribe(Guid id)
    {
        if (_subscribers.TryRemove(id, out var sub)) sub.Channel.Writer.TryComplete();
    }

    /// <summary>Sends to everyone except <paramref name="exceptUserId"/>'s own tabs are NOT excluded —
    /// the originating tab filters by its own <c>originId</c> instead, so a second tab of the
    /// same person still updates.</summary>
    public void Publish(string type, object payload, string? originId = null)
    {
        var frame = JsonSerializer.Serialize(new { type, origin = originId, data = payload }, Json);
        foreach (var sub in _subscribers.Values) sub.Channel.Writer.TryWrite(frame);
    }
}
