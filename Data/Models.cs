namespace IdeasBoard.Data;

/// <summary>Idea lifecycle. Persisted as the integer value — never reorder.</summary>
public enum IdeaStatus
{
    New = 0,
    Promising = 1,
    InProgress = 2,
    Research = 3,
    Hold = 4,
    Buried = 5,
}

/// <summary>
/// Activity log kinds. Persisted as the integer value — append new kinds, never
/// renumber, or historical rows change meaning.
/// </summary>
public enum EventKind
{
    LoginSuccess = 1,
    LoginFailed = 2,
    Logout = 3,
    BoardOpened = 4,
    LoginLocked = 5,
    LoginGitLab = 6,
    GitLabLinked = 7,

    IdeaCreated = 10,
    IdeaStatusChanged = 11,
    // No longer written: moving a note is not a decision worth a log row. Kept
    // so rows recorded before that decision still read as what they are.
    IdeaMoved = 12,
    IdeaTextEdited = 13,
    IdeaDeleted = 14,

    UserCreated = 20,
    UserActivationChanged = 21,
    UserPasswordReset = 22,
    UserDeleted = 23,
    UserUnlocked = 24,

    LogPruned = 30,
}

public sealed record User(
    long Id,
    string Email,
    string DisplayName,
    bool IsAdmin,
    bool IsActive,
    long CreatedAt,
    long? LastSeenAt,
    /// <summary>GitLab handle when the account is linked to SSO, otherwise null.</summary>
    string? GitLabUsername = null);

public sealed record Idea(
    long Id,
    string Text,
    int Status,
    double X,
    double Y,
    double Angle,
    long AuthorId,
    string AuthorName,
    string AuthorEmail,
    long CreatedAt,
    long UpdatedAt,
    long? StatusChangedAt,
    long? StatusChangedBy);
