from enum import Enum


class TaskType(str, Enum):
    CLASSIFICATION = "CLASSIFICATION"
    DETECTION = "DETECTION"
    SEGMENTATION = "SEGMENTATION"


class ImageStatus(str, Enum):
    NEW = "NEW"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"


class JobStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    ANNOTATOR = "ANNOTATOR"
    REVIEWER = "REVIEWER"


class ReviewStatus(str, Enum):
    UNREVIEWED = "UNREVIEWED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    NEEDS_REVISION = "NEEDS_REVISION"


class ImageSplit(str, Enum):
    UNASSIGNED = "UNASSIGNED"
    TRAIN = "TRAIN"
    VALID = "VALID"
    TEST = "TEST"


class VersionStatus(str, Enum):
    GENERATING = "GENERATING"
    READY = "READY"
    FAILED = "FAILED"


class AnnotationJobStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    REVIEW = "REVIEW"
